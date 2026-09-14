// 剧本回放模型：按预设序列返回响应，不发起网络请求；用于离线验证评估链路与可复现测试
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type {
  GenerateOptions,
  Message,
  Model,
  ModelResponse,
  ToolCall
} from "../../core/model.js";

// 一个剧本节点的响应描述
export interface ScriptedResponse {
  content?: string | null;
  toolCalls?: ToolCall[];
  finishReason?: ModelResponse["finishReason"];
  usage?: { promptTokens: number; completionTokens: number };
}

// 逐轮回放剧本，超出剧本后返回 stop + 提示文本
export class ScriptedModel implements Model {
  name: string;
  private readonly script: ScriptedResponse[];
  private cursor = 0;

  constructor(script: ScriptedResponse[], name = "scripted") {
    this.name = name;
    this.script = script;
  }

  // 已回放的轮数（供测试断言）
  get played(): number {
    return this.cursor;
  }

  // 重置回放游标：实验调度器多次复用同一实例前调用（协议外扩展，幂等安全）
  reset(): void {
    this.cursor = 0;
  }

  async generate(_messages: Message[], _options?: GenerateOptions): Promise<ModelResponse> {
    void _messages;
    void _options;

    if (this.cursor >= this.script.length) {
      return {
        content: "[scripted] 剧本已耗尽",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop"
      };
    }
    const step = this.script[this.cursor];
    this.cursor += 1;
    const promptTokens = step.usage?.promptTokens ?? 10;
    const completionTokens = step.usage?.completionTokens ?? 5;
    return {
      content: step.content ?? null,
      toolCalls: step.toolCalls,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens
      },
      finishReason: step.toolCalls !== undefined ? "tool_calls" : (step.finishReason ?? "stop")
    };
  }
}

// 快捷构造一次工具调用节点；自增 id 保证同轮同名工具也能配对
let callSeq = 0;
export function scriptedToolCall(name: string, args: Record<string, unknown>): ToolCall {
  callSeq += 1;
  return { id: `call_${callSeq}`, name, arguments: args };
}
