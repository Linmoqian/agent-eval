// OpenAI Chat Completions 适配器：原生 fetch 直调 REST API，实现统一 Model 协议
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type {
  GenerateOptions,
  Message,
  Model,
  ModelResponse,
  ToolCall,
  ToolSpec
} from "../../core/model.js";

const API_URL = "https://api.openai.com/v1/chat/completions";

// OpenAI 请求体中的消息格式
interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

// OpenAI 响应体中裁剪出的必要字段
interface OpenAIResponse {
  choices: {
    message: {
      content: string | null;
      tool_calls?: {
        id: string;
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// 统一消息 → OpenAI 消息格式
function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls !== undefined) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: JSON.stringify(c.arguments) }
        }))
      };
    }
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content ?? "",
        tool_call_id: m.toolCallId
      };
    }
    return { role: m.role, content: m.content };
  });
}

// 工具声明 → OpenAI function 声明
function toOpenAITools(tools: ToolSpec[]): { type: "function"; function: ToolSpec }[] {
  return tools.map((t) => ({ type: "function" as const, function: t }));
}

// OpenAI tool_calls → 统一 ToolCall（arguments 为 JSON 字符串，需解析）
function toToolCalls(
  raw: { id: string; function: { name: string; arguments: string } }[] | undefined
): ToolCall[] | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  return raw.map((c) => ({
    id: c.id,
    name: c.function.name,
    arguments: JSON.parse(c.function.arguments || "{}") as Record<string, unknown>
  }));
}

// OpenAI 适配器：换模型只换此实例，Agent 不感知厂商
export class OpenAIModel implements Model {
  name: string;
  private readonly apiKey: string;

  constructor(
    // 模型名，默认 gpt-4o-mini
    modelName: string = process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    // 显式传入 key，缺省读环境变量
    apiKey: string = process.env.OPENAI_API_KEY ?? ""
  ) {
    this.name = modelName;
    this.apiKey = apiKey;
  }

  async generate(messages: Message[], options?: GenerateOptions): Promise<ModelResponse> {
    if (this.apiKey.length === 0) {
      throw new Error("缺少 OPENAI_API_KEY（环境变量或构造参数）");
    }

    const body: Record<string, unknown> = {
      model: this.name,
      messages: toOpenAIMessages(messages)
    };
    if (options?.tools !== undefined && options.tools.length > 0) {
      body.tools = toOpenAITools(options.tools);
    }
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    const http = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!http.ok) {
      throw new Error(`OpenAI 请求失败: ${http.status} ${(await http.text()).slice(0, 200)}`);
    }

    const data = (await http.json()) as OpenAIResponse;
    const choice = data.choices[0];
    // OpenAI finish_reason → 统一枚举
    const finishReason: ModelResponse["finishReason"] =
      choice.finish_reason === "tool_calls"
        ? "tool_calls"
        : choice.finish_reason === "length"
          ? "length"
          : "stop";

    return {
      content: choice.message.content ?? null,
      toolCalls: toToolCalls(choice.message.tool_calls),
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0
      },
      finishReason,
      raw: data
    };
  }
}
