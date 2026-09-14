// 先规划后执行 Agent：单模型两阶段——planning 产出计划 → executing 顺序执行各步 → finalizing 总结
// 结构特点：计划只生成一次、顺序执行不回头；步内允许工具循环，步失败不触发重规划
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

// 总轮数上限（规划 + 执行 + 总结的全部模型调用）
const DEFAULT_MAX_STEPS = 40;
// 单个计划步内的最大模型调用轮数
const STEP_MAX_ROUNDS = 5;

const PLANNER_SYSTEM = [
  "你是一个任务规划器。把用户的任务拆解为可直接执行的分步计划。",
  "只输出一个 JSON 字符串数组，每个元素是一步的自然语言描述，不要输出任何其他内容。"
].join("\n");

const EXECUTOR_SYSTEM = [
  "你是一个计划执行器。按用户给出的分步计划逐步执行，使用提供的工具完成当前步骤。",
  "当前步骤完成后回复 DONE，不要回复其他内容；未完成则继续调用工具。"
].join("\n");

export class PlanExecuteAgent implements Agent {
  name = "plan-execute";
  private model: Model | null = null;
  private toolPool: Tool[] = [];
  private fallbackMaxSteps = DEFAULT_MAX_STEPS;

  async init(config: AgentConfig): Promise<void> {
    this.model = config.model;
    this.toolPool = config.tools ?? [];
    if (config.maxSteps !== undefined) this.fallbackMaxSteps = config.maxSteps;
  }

  async run(task: Task): Promise<AgentResult> {
    const model = requireModel(this.model, this.name);
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
      // ===== Phase 1: planning（无工具，只产计划）=====
      trace.record({ kind: "agent_state", phase: "planning" });
      const planMessages: Message[] = [
        { role: "system", content: PLANNER_SYSTEM },
        { role: "user", content: buildTaskPrompt(task) }
      ];
      round += 1;
      recordModelRequest(trace, { round, purpose: "plan", messageCount: planMessages.length });
      const planResp = await model.generate(planMessages);
      recordModelResponse(trace, planResp);
      addUsage(usage, planResp.usage);

      const plan = parsePlanList(planResp.content);
      if (plan === null) {
        // 计划解析失败：降级为直接作答，真伪交给评估器
        trace.record({
          kind: "error",
          message: "计划解析失败，降级为直接作答",
          fatal: false
        });
        return {
          taskId: task.task_id,
          agentName: this.name,
          success: planResp.finishReason === "stop",
          finalAnswer: planResp.content,
          trace,
          usage,
          durationMs: Date.now() - startedAt,
          error: "计划解析失败"
        };
      }

      const steps: PlanStep[] = plan.map((description, i) => ({
        index: i + 1,
        description,
        status: "pending" as const
      }));
      trace.record({ kind: "plan_created", steps });

      // ===== Phase 2: executing（计划贯穿单一消息历史）=====
      trace.record({ kind: "agent_state", phase: "executing" });
      const execMessages: Message[] = [
        { role: "system", content: EXECUTOR_SYSTEM },
        {
          role: "user",
          content: `${buildTaskPrompt(task)}\n\n分步计划：\n${formatPlan(steps)}`
        }
      ];

      for (const step of steps) {
        if (round >= maxSteps) break;
        step.status = "in_progress";
        trace.record({ kind: "plan_updated", change: "step_started", stepIndex: step.index });
        execMessages.push({
          role: "user",
          content: `当前执行第 ${step.index} 步：${step.description}\n完成后回复 DONE。`
        });

        let stepDone = false;
        for (let r = 0; r < STEP_MAX_ROUNDS && round < maxSteps; r++) {
          round += 1;
          recordModelRequest(trace, {
            round,
            purpose: "act",
            messageCount: execMessages.length,
            tools: toolNames
          });
          const resp = await model.generate(execMessages, generateOptions);
          recordModelResponse(trace, resp);
          addUsage(usage, resp.usage);
          execMessages.push({
            role: "assistant",
            content: resp.content,
            toolCalls: resp.toolCalls
          });

          const calls = resp.toolCalls ?? [];
          // 模型回文本即视为本步完成（宽协议：不校验字面 DONE，防措辞差异死循环）
          if (calls.length === 0) {
            stepDone = true;
            break;
          }
          for (const call of calls) {
            const { observation } = await runToolCall(trace, tools, call);
            execMessages.push({
              role: "tool",
              content: observation,
              toolCallId: call.id,
              name: call.name
            });
          }
        }

        if (stepDone) {
          step.status = "completed";
          trace.record({ kind: "plan_updated", change: "step_completed", stepIndex: step.index });
        } else {
          // plan-execute 不重规划：步失败记录后顺序推进
          step.status = "failed";
          trace.record({
            kind: "plan_updated",
            change: "step_failed",
            stepIndex: step.index,
            note: "步内轮数耗尽"
          });
        }
      }

      // ===== Phase 3: finalizing =====
      trace.record({ kind: "agent_state", phase: "finalizing" });
      let finalAnswer: string | null = null;
      if (round < maxSteps) {
        round += 1;
        recordModelRequest(trace, {
          round,
          purpose: "final",
          messageCount: execMessages.length
        });
        const finalResp = await model.generate(execMessages);
        recordModelResponse(trace, finalResp);
        addUsage(usage, finalResp.usage);
        finalAnswer = finalResp.content;
      }

      return {
        taskId: task.task_id,
        agentName: this.name,
        success: finalAnswer !== null,
        finalAnswer,
        trace,
        usage,
        durationMs: Date.now() - startedAt,
        error: finalAnswer === null ? `步数耗尽: ${round}/${maxSteps}` : undefined
      };
    } catch (err) {
      trace.record({ kind: "error", message: String(err), fatal: true });
      return {
        taskId: task.task_id,
        agentName: this.name,
        success: false,
        finalAnswer: null,
        trace,
        usage,
        durationMs: Date.now() - startedAt,
        error: String(err)
      };
    }
  }

  async reset(): Promise<void> {
    // PlanExecuteAgent 每次 run 内部自建全部状态，无需清理
  }
}
