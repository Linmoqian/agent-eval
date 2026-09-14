// 模型价格元数据：价格属于模型元数据而非推理行为，独立于 Model 协议维护
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

// 单一模型定价（美元 / 百万 token）
export interface ModelPricing {
  // 输入单价（USD / 1M prompt tokens）
  inputPerMillion: number;
  // 输出单价（USD / 1M completion tokens）
  outputPerMillion: number;
}

// 价格表：手工维护的公开标价快照，仅供成本估算（可能过期，以厂商页面为准）
// key 为模型名前缀，匹配时先精确后取最长前缀
const PRICING_TABLE: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "o4-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  // DeepSeek
  "deepseek-chat": { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  "deepseek-reasoner": { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  // 智谱 GLM
  "glm-4.5": { inputPerMillion: 0.6, outputPerMillion: 2.2 },
  "glm-4.5-air": { inputPerMillion: 0.2, outputPerMillion: 1.1 },
  // Moonshot Kimi
  "kimi-k2": { inputPerMillion: 0.6, outputPerMillion: 2.5 },
  "kimi-k3": { inputPerMillion: 0.6, outputPerMillion: 2.5 },
  // xAI Grok
  "grok-4": { inputPerMillion: 3, outputPerMillion: 15 },
  // Google Gemini
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10 },
  "gemini-2.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  // Anthropic Claude
  "claude-sonnet-4-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-opus-4-1": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-3-5-haiku": { inputPerMillion: 0.8, outputPerMillion: 4 }
};

// 按模型名查价：先精确匹配，再取最长前缀（覆盖带日期后缀的快照名，如 gpt-4o-2024-08-06）
export function getPricing(modelName: string): ModelPricing | undefined {
  const exact = PRICING_TABLE[modelName];
  if (exact !== undefined) return exact;

  let best: { prefix: string; pricing: ModelPricing } | null = null;
  for (const [prefix, pricing] of Object.entries(PRICING_TABLE)) {
    if (modelName.startsWith(prefix) && (best === null || prefix.length > best.prefix.length)) {
      best = { prefix, pricing };
    }
  }
  return best?.pricing;
}

// 成本估算（USD）：usage × 单价；无价格表条目时返回 undefined
export function estimateCostUsd(
  modelName: string,
  usage: { promptTokens: number; completionTokens: number }
): { cost: number; pricing: ModelPricing } | undefined {
  const pricing = getPricing(modelName);
  if (pricing === undefined) return undefined;
  const cost =
    (usage.promptTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.completionTokens / 1_000_000) * pricing.outputPerMillion;
  return { cost, pricing };
}
