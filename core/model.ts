// 模型抽象：统一各厂商 LLM 的调用接口，Agent 只依赖此协议
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

import type { ToolCall, ToolSpec } from "./tool.js";

// 便捷重导出：模型适配器从 model.js 即可拿到全部相关类型
export type { ToolCall, ToolSpec } from "./tool.js";

// 消息角色
export type MessageRole = "system" | "user" | "assistant" | "tool";

// 统一消息格式，各厂商适配器负责与原生格式互转
export interface Message {
  role: MessageRole;
  // 文本内容；assistant 仅返回工具调用时可为 null
  content: string | null;
  // assistant 消息携带的工具调用请求
  toolCalls?: ToolCall[];
  // tool 消息对应的调用标识
  toolCallId?: string;
  // tool 消息来源的工具名
  name?: string;
}

// 单次生成的 token 用量，成本/效率评估的数据来源
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// 生成参数：工具声明与采样控制
export interface GenerateOptions {
  // 暴露给模型的工具声明
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
}

// 统一模型响应，屏蔽各厂商差异
export interface ModelResponse {
  // 文本输出，仅返回工具调用时可为 null
  content: string | null;
  // 模型发起的工具调用列表
  toolCalls?: ToolCall[];
  // 本次 token 用量
  usage: TokenUsage;
  // 结束原因
  finishReason: "stop" | "tool_calls" | "length" | "error";
  // 厂商原始响应，便于调试与溯源
  raw?: unknown;
}

// 模型协议：Agent 不知道底层是 GPT / Claude / Qwen，换模型只换适配器实例
export interface Model {
  // 模型标识，如 "gpt-4o" / "qwen-max"
  name: string;
  // 发送对话，返回统一响应
  generate(
    messages: Message[],
    options?: GenerateOptions
  ): Promise<ModelResponse>;
}
