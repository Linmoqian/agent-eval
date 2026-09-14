// 成本评估器：token 用量 × 模型价格元数据估算费用
// 价格独立维护于 core/pricing.ts（模型元数据，不属于推理行为），无价格条目时标记而非报错
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type {
  EvaluationContext,
  EvaluationResult,
  Evaluator
} from "../../core/evaluator.js";
import { estimateCostUsd } from "../../core/pricing.js";

// 成本明细
export interface CostDetails {
  inputTokens: number;
  outputTokens: number;
  // 估算费用（USD）；价格表未收录时为 null
  estimatedCostUsd: number | null;
  // 是否命中价格表
  priced: boolean;
  // 命中的价格表前缀（如 "gpt-4o-mini"）
  matchedPricing?: string;
}

// 运行成本观测：观测型评估器，无绝对分数
export class CostEvaluator implements Evaluator<CostDetails> {
  name = "cost";

  async evaluate(context: EvaluationContext): Promise<EvaluationResult<CostDetails>> {
    const { trace, modelName } = context;

    // token 用量唯一来源：model_response 事件
    let inputTokens = 0;
    let outputTokens = 0;
    for (const step of trace.steps) {
      if (step.kind === "model_response") {
        inputTokens += step.usage.promptTokens;
        outputTokens += step.usage.completionTokens;
      }
    }

    const estimate =
      modelName !== undefined
        ? estimateCostUsd(modelName, { promptTokens: inputTokens, completionTokens: outputTokens })
        : undefined;

    return {
      evaluator: this.name,
      score: 1,
      passed: true,
      details: {
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimate?.cost ?? null,
        priced: estimate !== undefined,
        matchedPricing:
          estimate !== undefined
            ? `${estimate.pricing.inputPerMillion}/${estimate.pricing.outputPerMillion} USD/1M`
            : undefined
      }
    };
  }
}
