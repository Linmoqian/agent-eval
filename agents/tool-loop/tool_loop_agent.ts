// 工具循环 Agent：模型请求工具 → 执行 → observation 回传 → 循环，直至出文本/超步/出错
// 结构特点：无显式推理步骤、每轮可并行发起多个工具调用
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type { Agent, AgentConfig, AgentResult } from "../../core/agent.js";
import type { Message, Model, TokenUsage } from "../../core/model.js";
import type { Task } from "../../core/task.js";
import type { Tool } from "../../core/tool.js";
import { createTrace } from "../../core/trace.js";
import {
  addUsage,
  buildTaskPrompt,
  recordModelRequest,
  recordModelResponse,
  requireModel,
  runToolCall,
  selectTools
} from "../common.js";

// 默认迭代上限，与任务 constraints.max_steps 取较小值（每轮模型调用记一步）
const DEFAULT_MAX_STEPS = 20;

export class ToolLoopAgent implements Agent {
  name = "tool-loop";
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

    const messages: Message[] = [
      {
        role: "system",
        content:
          "你是一个任务执行 Agent。使用提供的工具完成任务，所有目标完成后给出简短总结。"
      },
      { role: "user", content: buildTaskPrompt(task) }
    ];

    try {
      let round = 0;
      let finalAnswer: string | null = null;
      while (round < maxSteps) {
        round += 1;
        recordModelRequest(trace, {
          round,
          purpose: "act",
          messageCount: messages.length,
          tools: toolNames
        });
        const resp = await model.generate(messages, generateOptions);
        recordModelResponse(trace, resp);
        addUsage(usage, resp.usage);

        // 无工具调用：模型给出最终答案
        if (resp.toolCalls === undefined || resp.toolCalls.length === 0) {
          finalAnswer = resp.content;
          break;
        }

        // 记录 assistant 的工具调用消息（配对回传必需）
        messages.push({
          role: "assistant",
          content: resp.content,
          toolCalls: resp.toolCalls
        });

        for (const call of resp.toolCalls) {
          const { observation } = await runToolCall(trace, tools, call);
          messages.push({
            role: "tool",
            content: observation,
            toolCallId: call.id,
            name: call.name
          });
        }
      }

      const exhausted = finalAnswer === null && round >= maxSteps;
      if (exhausted) {
        trace.record({ kind: "error", message: `步数耗尽: ${round}/${maxSteps}`, fatal: true });
      }

      return {
        taskId: task.task_id,
        agentName: this.name,
        success: !exhausted,
        finalAnswer,
        trace,
        usage,
        durationMs: Date.now() - startedAt,
        error: exhausted ? `步数耗尽: ${round}/${maxSteps}` : undefined
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
    // ToolLoopAgent 每次 run 内部自建全部状态，无需清理
  }
}
