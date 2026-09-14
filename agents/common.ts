// Agent 公共逻辑：任务提示词构造、模型调用事件记录、usage 汇总
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type { ModelResponse, TokenUsage } from "../core/model.js";
import type { Task } from "../core/task.js";
import type { Trace } from "../core/trace.js";

// 把任务拼成 user 消息：指令 + 结构化输入，所有架构共用同一输入协议
export function buildTaskPrompt(task: Task): string {
  const lines = [task.instruction];
  const inputKeys = Object.keys(task.input);
  if (inputKeys.length > 0) {
    lines.push("", "任务输入：", JSON.stringify(task.input, null, 2));
  }
  if (task.tools.length > 0) {
    lines.push("", `可用工具：${task.tools.join(", ")}`);
  }
  return lines.join("\n");
}

// 把一次模型响应记为 model_call 事件（统一观测层，token 汇总从 Trace 派生）
export function recordModelCall(trace: Trace, resp: ModelResponse): void {
  const summary =
    resp.toolCalls !== undefined
      ? `finish=${resp.finishReason}, tools=[${resp.toolCalls.map((c) => c.name).join(", ")}]`
      : `finish=${resp.finishReason}, content=${(resp.content ?? "").slice(0, 120)}`;
  trace.record({
    kind: "model_call",
    thought: summary,
    usage: resp.usage
  });
}

// 累加 usage
export function addUsage(target: TokenUsage, delta: TokenUsage): void {
  target.promptTokens += delta.promptTokens;
  target.completionTokens += delta.completionTokens;
  target.totalTokens += delta.totalTokens;
}
