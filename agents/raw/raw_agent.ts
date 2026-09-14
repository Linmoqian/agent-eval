// 基线 Agent：单次调用模型直接作答，不使用工具、不循环
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type { Agent, AgentConfig, AgentResult } from "../../core/agent.js";
import type { Model, TokenUsage } from "../../core/model.js";
import type { Task } from "../../core/task.js";
import { createTrace } from "../../core/trace.js";
import {
  addUsage,
  buildTaskPrompt,
  recordModelRequest,
  recordModelResponse,
  requireModel
} from "../common.js";

export class RawAgent implements Agent {
  name = "raw";
  private model: Model | null = null;

  async init(config: AgentConfig): Promise<void> {
    this.model = config.model;
  }

  async run(task: Task): Promise<AgentResult> {
    const model = requireModel(this.model, this.name);
    const startedAt = Date.now();
    const trace = createTrace(task.task_id, this.name);
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      const messages = [{ role: "user" as const, content: buildTaskPrompt(task) }];
      recordModelRequest(trace, { round: 1, purpose: "final", messageCount: messages.length });
      const resp = await model.generate(messages);
      recordModelResponse(trace, resp);
      addUsage(usage, resp.usage);
      // 基线自判：正常生成即视为「完成了它自己能做的」，真伪由评估器裁决
      return {
        taskId: task.task_id,
        agentName: this.name,
        success: resp.finishReason === "stop",
        finalAnswer: resp.content,
        trace,
        usage,
        durationMs: Date.now() - startedAt
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
    // RawAgent 无内部状态，无需清理
  }
}
