// Planner/Executor 分离 Agent：规划与执行是两个独立角色（各自独立消息上下文）
// 结构特点：执行中观测到失败立即回 Planner 重规划（计划修订），是恢复能力（M7）的结构基础
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { Agent, AgentConfig, AgentResult } from "../../core/agent.js";
import type { Message, Model, TokenUsage } from "../../core/model.js";
import type { Task } from "../../core/task.js";
import type { Tool } from "../../core/tool.js";
import { createTrace, type PlanStep } from "../../core/trace.js";
import {
  addUsage,
  buildTaskPrompt,
  formatPlan,
  parsePlanList,
  recordModelRequest,
  recordModelResponse,
  requireModel,
  runToolCall,
  selectTools
} from "../common.js";

// 总轮数上限（planner + executor + 总结的全部模型调用）
const DEFAULT_MAX_STEPS = 40;
// 单个计划步内的最大 executor 调用轮数
const STEP_MAX_ROUNDS = 5;
// 重规划次数上限，防止失败-重规划死循环
const MAX_REPLANS = 3;

const PLANNER_SYSTEM = [
  "你是一个任务规划器（Planner）。把任务拆解为可直接执行的分步计划。",
  "只输出一个 JSON 字符串数组，每个元素是一步的自然语言描述，不要输出任何其他内容。",
  "收到执行进度与失败反馈时，输出覆盖剩余目标的新计划。"
].join("\n");

const EXECUTOR_SYSTEM = [
  "你是一个计划执行器（Executor）。严格按当前计划逐步执行，使用提供的工具完成当前步骤。",
  "当前步骤完成后回复 DONE，不要回复其他内容；未完成则继续调用工具。"
].join("\n");

export class PlannerExecutorAgent implements Agent {
  name = "planner-executor";
  private model: Model | null = null;
  // Planner 模型可与 Executor 不同（缺省复用注入的 model）
  private plannerModel: Model | null = null;
  private toolPool: Tool[] = [];
  private fallbackMaxSteps = DEFAULT_MAX_STEPS;

  async init(config: AgentConfig): Promise<void> {
    this.model = config.model;
    // options.plannerModel 允许注入独立规划模型；类型不匹配时回退主模型
    const candidate = config.options?.plannerModel;
    this.plannerModel =
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as Model).generate === "function"
        ? (candidate as Model)
        : config.model;
    this.toolPool = config.tools ?? [];
    if (config.maxSteps !== undefined) this.fallbackMaxSteps = config.maxSteps;
  }

  async run(task: Task): Promise<AgentResult> {
    const executorModel = requireModel(this.model, this.name);
    const plannerModel = requireModel(this.plannerModel, this.name);
    const startedAt = Date.now();
    const trace = createTrace(task.task_id, this.name);
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const { tools, toolNames, specs } = selectTools(this.toolPool, task.tools);
    const generateOptions = specs.length > 0 ? { tools: specs } : undefined;
    const maxSteps = Math.min(
      task.constraints?.max_steps ?? Number.MAX_SAFE_INTEGER,
      this.fallbackMaxSteps
    );

    let round = 0;
    try {
      // ===== Phase 1: planning（Planner 独立上下文）=====
      trace.record({ kind: "agent_state", phase: "planning" });
      const plannerMessages: Message[] = [
        { role: "system", content: PLANNER_SYSTEM },
        { role: "user", content: buildTaskPrompt(task) }
      ];
      round += 1;
      recordModelRequest(trace, {
        round,
        purpose: "plan",
        messageCount: plannerMessages.length
      });
      const planResp = await plannerModel.generate(plannerMessages);
      recordModelResponse(trace, planResp);
      addUsage(usage, planResp.usage);

      const initialPlan = parsePlanList(planResp.content);
      if (initialPlan === null) {
        trace.record({ kind: "error", message: "初始计划解析失败", fatal: true });
        return this.fail(task, trace, usage, startedAt, "初始计划解析失败");
      }

      let steps: PlanStep[] = initialPlan.map((description, i) => ({
        index: i + 1,
        description,
        status: "pending" as const
      }));
      trace.record({ kind: "plan_created", steps });

      // ===== Phase 2: executing（Executor 独立上下文，贯穿重规划）=====
      trace.record({ kind: "agent_state", phase: "executing" });
      const execMessages: Message[] = [
        { role: "system", content: EXECUTOR_SYSTEM },
        {
          role: "user",
          content: `${buildTaskPrompt(task)}\n\n分步计划：\n${formatPlan(steps)}`
        }
      ];

      let replans = 0;
      let i = 0;
      let fatal: string | null = null;
      while (i < steps.length) {
        if (round >= maxSteps) {
          fatal = `步数耗尽: ${round}/${maxSteps}`;
          trace.record({ kind: "error", message: fatal, fatal: true });
          break;
        }
        const step = steps[i];
        step.status = "in_progress";
        trace.record({ kind: "plan_updated", change: "step_started", stepIndex: step.index });
        execMessages.push({
          role: "user",
          content: `当前执行第 ${step.index} 步：${step.description}\n完成后回复 DONE。`
        });

        let stepDone = false;
        let stepFailed = false;
        for (let r = 0; r < STEP_MAX_ROUNDS && round < maxSteps; r++) {
          round += 1;
          recordModelRequest(trace, {
            round,
            purpose: "act",
            messageCount: execMessages.length,
            tools: toolNames
          });
          const resp = await executorModel.generate(execMessages, generateOptions);
          recordModelResponse(trace, resp);
          addUsage(usage, resp.usage);
          execMessages.push({
            role: "assistant",
            content: resp.content,
            toolCalls: resp.toolCalls
          });

          const calls = resp.toolCalls ?? [];
          if (calls.length === 0) {
            stepDone = true;
            break;
          }
          let anyFailed = false;
          for (const call of calls) {
            const { observation, ok } = await runToolCall(trace, tools, call);
            execMessages.push({
              role: "tool",
              content: observation,
              toolCallId: call.id,
              name: call.name
            });
            if (!ok) anyFailed = true;
          }
          // 结构差异核心：观测到失败立即上抛 Planner，不在步内反复重试
          if (anyFailed) {
            stepFailed = true;
            break;
          }
        }

        if (stepDone) {
          step.status = "completed";
          trace.record({ kind: "plan_updated", change: "step_completed", stepIndex: step.index });
          i += 1;
          continue;
        }

        // 步失败（工具观测失败或步内轮数耗尽）→ 回 Planner 重规划
        step.status = "failed";
        trace.record({
          kind: "plan_updated",
          change: "step_failed",
          stepIndex: step.index,
          note: stepFailed ? "工具观测到失败" : "步内轮数耗尽"
        });

        if (replans >= MAX_REPLANS) {
          fatal = `重规划次数耗尽: ${replans}/${MAX_REPLANS}`;
          trace.record({ kind: "error", message: fatal, fatal: true });
          break;
        }
        replans += 1;
        const completedDesc = steps
          .filter((s) => s.status === "completed")
          .map((s) => s.description);
        trace.record({
          kind: "agent_state",
          phase: "replanning",
          note: `第 ${step.index} 步失败，第 ${replans} 次重规划`
        });
        plannerMessages.push({
          role: "user",
          content: [
            `执行到第 ${step.index} 步「${step.description}」时失败。`,
            `已完成步骤：${completedDesc.length > 0 ? completedDesc.join("；") : "无"}`,
            "请输出覆盖剩余目标的 JSON 字符串数组新计划。"
          ].join("\n")
        });
        round += 1;
        recordModelRequest(trace, {
          round,
          purpose: "replan",
          messageCount: plannerMessages.length
        });
        const replanResp = await plannerModel.generate(plannerMessages);
        recordModelResponse(trace, replanResp);
        addUsage(usage, replanResp.usage);

        const revised = parsePlanList(replanResp.content);
        if (revised === null) {
          fatal = "修订计划解析失败";
          trace.record({ kind: "error", message: fatal, fatal: true });
          break;
        }
        steps = revised.map((description, k) => ({
          index: k + 1,
          description,
          status: "pending" as const
        }));
        trace.record({
          kind: "plan_updated",
          change: "revised",
          steps,
          note: `第 ${replans} 次重规划`
        });
        // 新计划从头执行，Executor 上下文保留历史观测
        execMessages.push({
          role: "user",
          content: `计划已修订，剩余计划：\n${formatPlan(steps)}`
        });
        i = 0;
      }

      // ===== Phase 3: finalizing（Executor 总结）=====
      let finalAnswer: string | null = null;
      if (fatal === null) {
        trace.record({ kind: "agent_state", phase: "finalizing" });
        if (round < maxSteps) {
          round += 1;
          recordModelRequest(trace, {
            round,
            purpose: "final",
            messageCount: execMessages.length
          });
          const finalResp = await executorModel.generate(execMessages);
          recordModelResponse(trace, finalResp);
          addUsage(usage, finalResp.usage);
          finalAnswer = finalResp.content;
        } else {
          fatal = `步数耗尽: ${round}/${maxSteps}`;
        }
      }

      return {
        taskId: task.task_id,
        agentName: this.name,
        success: finalAnswer !== null,
        finalAnswer,
        trace,
        usage,
        durationMs: Date.now() - startedAt,
        error: fatal ?? undefined
      };
    } catch (err) {
      trace.record({ kind: "error", message: String(err), fatal: true });
      return this.fail(task, trace, usage, startedAt, String(err));
    }
  }

  // 统一失败出口
  private fail(
    task: Task,
    trace: ReturnType<typeof createTrace>,
    usage: TokenUsage,
    startedAt: number,
    error: string
  ): AgentResult {
    return {
      taskId: task.task_id,
      agentName: this.name,
      success: false,
      finalAnswer: null,
      trace,
      usage,
      durationMs: Date.now() - startedAt,
      error
    };
  }

  async reset(): Promise<void> {
    // PlannerExecutorAgent 每次 run 内部自建全部状态，无需清理
  }
}
