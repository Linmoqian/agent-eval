// Agent 公共逻辑：任务提示词构造、模型调用事件记录、工具执行、计划解析、usage 汇总
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { Model, ModelResponse, TokenUsage } from "../core/model.js";
import type { Task } from "../core/task.js";
import type { Tool, ToolCall, ToolSpec } from "../core/tool.js";
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

// 发起模型调用前记录请求侧事件（与 recordModelResponse 成对，时间戳差即延迟）
export function recordModelRequest(
  trace: Trace,
  meta: {
    round: number;
    purpose?: string;
    messageCount?: number;
    tools?: string[];
  }
): void {
  trace.record({ kind: "model_call", ...meta });
}

// 收到响应后记录响应侧事件：usage / finishReason / content / toolCalls 原样入轨迹
export function recordModelResponse(trace: Trace, resp: ModelResponse): void {
  trace.record({
    kind: "model_response",
    finishReason: resp.finishReason,
    content: resp.content,
    toolCalls: resp.toolCalls,
    usage: resp.usage
  });
}

// 工具执行结果：observation 字符串 + 是否成功
export interface ToolRunOutcome {
  observation: string;
  ok: boolean;
}

// 执行一次工具调用并记入轨迹（tool_call + tool_result 成对）
// 环境约定：观测对象含 ok:false 视为业务失败，执行异常同样记失败
export async function runToolCall(
  trace: Trace,
  tools: Tool[],
  call: ToolCall
): Promise<ToolRunOutcome> {
  trace.record({ kind: "tool_call", call });
  const impl = tools.find((t) => t.name === call.name);
  const startedAt = Date.now();
  let output: unknown;
  let ok = true;
  if (impl === undefined) {
    output = { ok: false, reason: `unknown_tool: ${call.name}` };
    ok = false;
  } else {
    try {
      output = await impl.execute(call.arguments);
      if (
        typeof output === "object" &&
        output !== null &&
        (output as { ok?: unknown }).ok === false
      ) {
        ok = false;
      }
    } catch (err) {
      output = { ok: false, reason: `tool_error: ${String(err)}` };
      ok = false;
    }
  }
  const observation = JSON.stringify(output);
  trace.record({
    kind: "tool_result",
    callId: call.id,
    name: call.name,
    observation,
    ok,
    durationMs: Date.now() - startedAt
  });
  return { observation, ok };
}

// 从模型文本中提取 JSON 字符串数组形式的计划；容忍 ```json 围栏与前后杂文
export function parsePlanList(content: string | null | undefined): string[] | null {
  if (typeof content !== "string") return null;
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence !== null ? fence[1] : content;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!parsed.every((s) => typeof s === "string")) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

// 按任务允许的工具列表取子集，并产出模型侧工具声明
export function selectTools(
  pool: Tool[],
  allowedNames: string[]
): { tools: Tool[]; toolNames: string[]; specs: ToolSpec[] } {
  const allowed = new Set(allowedNames);
  const tools = pool.filter((t) => allowed.has(t.name));
  return {
    tools,
    toolNames: tools.map((t) => t.name),
    specs: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }))
  };
}

// 把计划格式化为编号文本，拼进执行上下文
export function formatPlan(steps: { index: number; description: string }[]): string {
  return steps.map((s) => `${s.index}. ${s.description}`).join("\n");
}

// 累加 usage
export function addUsage(target: TokenUsage, delta: TokenUsage): void {
  target.promptTokens += delta.promptTokens;
  target.completionTokens += delta.completionTokens;
  target.totalTokens += delta.totalTokens;
}

// 类型守卫：确认模型实例存在，避免可空调用
export function requireModel(model: Model | null, agentName: string): Model {
  if (model === null) throw new Error(`${agentName} 未 init`);
  return model;
}
