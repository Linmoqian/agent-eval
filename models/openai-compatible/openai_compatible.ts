// OpenAI 兼容适配器：单一实现覆盖所有 Chat Completions 兼容厂商（openai/deepseek/glm/kimi/grok/gemini）
// 换厂商只是 { baseUrl, apiKey, model } 配置差异，Agent 代码零改动
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type {
  GenerateOptions,
  Message,
  Model,
  ModelResponse,
  ToolCall,
  ToolSpec
} from "../../core/model.js";

// 适配器构造参数：三元组完成厂商切换
export interface OpenAICompatibleConfig {
  // API 根地址，如 https://api.openai.com/v1
  baseUrl: string;
  apiKey: string;
  // 模型名，如 gpt-4o-mini / deepseek-chat / glm-4.5
  model: string;
  // 适配器显示名（缺省用 model）
  name?: string;
}

// 厂商预设：注册新厂商只需在此登记一行
export interface ProviderPreset {
  // 厂商 id（注册表键）
  provider: string;
  // Chat Completions 兼容端点
  baseUrl: string;
  // API key 环境变量名
  apiKeyEnv: string;
  // 默认模型（可被 <VENDOR>_MODEL 覆盖）
  defaultModel: string;
  // 模型覆盖环境变量名
  modelEnv: string;
  // 别名（resolveModel 时的等价 id）
  aliases?: string[];
}

// 厂商预设注册表（全部为 OpenAI Chat Completions 兼容协议）
const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    modelEnv: "OPENAI_MODEL"
  },
  deepseek: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    modelEnv: "DEEPSEEK_MODEL"
  },
  zhipu: {
    provider: "zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "ZHIPU_API_KEY",
    defaultModel: "glm-4.5",
    modelEnv: "ZHIPU_MODEL",
    aliases: ["glm"]
  },
  moonshot: {
    provider: "moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
    defaultModel: "kimi-k2",
    modelEnv: "MOONSHOT_MODEL",
    aliases: ["kimi"]
  },
  grok: {
    provider: "grok",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnv: "GROK_API_KEY",
    defaultModel: "grok-4",
    modelEnv: "GROK_MODEL"
  },
  gemini: {
    provider: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-pro",
    modelEnv: "GEMINI_MODEL"
  },
  qwen: {
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "QWEN_API_KEY",
    defaultModel: "qwen-max",
    modelEnv: "QWEN_MODEL",
    aliases: ["dashscope"]
  }
};

// Chat Completions 请求体中的消息格式
interface ChatMessage {
  role: string;
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

// Chat Completions 响应体中裁剪出的必要字段
interface ChatCompletionResponse {
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

// 统一消息 → Chat Completions 消息格式
function toChatMessages(messages: Message[]): ChatMessage[] {
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

// 工具声明 → function 声明
function toChatTools(tools: ToolSpec[]): { type: "function"; function: ToolSpec }[] {
  return tools.map((t) => ({ type: "function" as const, function: t }));
}

// 原生 tool_calls → 统一 ToolCall（arguments 为 JSON 字符串，需解析）
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

// OpenAI 兼容适配器：所有兼容厂商共用此实现
export class OpenAICompatibleModel implements Model {
  name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly providerLabel: string;

  constructor(config: OpenAICompatibleConfig, providerLabel = "openai-compatible") {
    this.name = config.name ?? config.model;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.providerLabel = providerLabel;
  }

  async generate(messages: Message[], options?: GenerateOptions): Promise<ModelResponse> {
    if (this.apiKey.length === 0) {
      throw new Error(`缺少 API key（${this.providerLabel}，baseUrl=${this.baseUrl}）`);
    }

    const body: Record<string, unknown> = {
      model: this.name,
      messages: toChatMessages(messages)
    };
    if (options?.tools !== undefined && options.tools.length > 0) {
      body.tools = toChatTools(options.tools);
    }
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    const http = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!http.ok) {
      throw new Error(
        `${this.providerLabel} 请求失败: ${http.status} ${(await http.text()).slice(0, 200)}`
      );
    }

    const data = (await http.json()) as ChatCompletionResponse;
    const choice = data.choices[0];
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

// 按厂商 id 解析预设（含别名，如 glm → zhipu）
export function resolveProviderPreset(providerId: string): ProviderPreset | undefined {
  const direct = PROVIDER_PRESETS[providerId];
  if (direct !== undefined) return direct;
  return Object.values(PROVIDER_PRESETS).find((p) =>
    p.aliases?.includes(providerId)
  );
}

// 列出全部可用厂商 id（含别名）
export function listProviders(): string[] {
  const ids: string[] = [];
  for (const preset of Object.values(PROVIDER_PRESETS)) {
    ids.push(preset.provider, ...(preset.aliases ?? []));
  }
  return ids;
}

// 从预设 + 环境变量构造适配器；modelOverride 形如 "deepseek:deepseek-reasoner"
// key 缺失时抛错（显式失败优于静默降级）
export function createCompatibleModel(
  providerId: string,
  modelOverride?: string
): OpenAICompatibleModel {
  const preset = resolveProviderPreset(providerId);
  if (preset === undefined) {
    throw new Error(`未注册的厂商: ${providerId}（可用: ${listProviders().join(", ")}）`);
  }
  const apiKey = process.env[preset.apiKeyEnv] ?? "";
  const model = modelOverride ?? process.env[preset.modelEnv] ?? preset.defaultModel;
  if (apiKey.length === 0) {
    throw new Error(`缺少 ${preset.apiKeyEnv}（厂商 ${preset.provider}）`);
  }
  return new OpenAICompatibleModel(
    { baseUrl: preset.baseUrl, apiKey, model },
    preset.provider
  );
}
