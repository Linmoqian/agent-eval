// 规划行为评估器：从 Trace 派生计划创建/修订与规划开销占比，区分架构的规划方式
// 观测型指标：planningOverhead 无绝对好坏，只描述 token 在规划与执行间的分配
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type {
  EvaluationContext,
  EvaluationResult,
  Evaluator
} from "../../core/evaluator.js";

// 规划明细：全部从 model_call / model_response / plan_* 事件派生
export interface PlanningDetails {
  // 模型调用总次数
  modelCalls: number;
  // 计划创建次数（plan_created 事件）
  plansCreated: number;
  // 计划修订次数（plan_updated.change === "revised"）
  planRevisions: number;
  // 规划目的调用（purpose 为 plan / replan）消耗的 token
  planningTokens: number;
  // 全部模型调用消耗的 token
  totalTokens: number;
  // 规划开销占比 = planningTokens / totalTokens（无 token 时无定义）
  planningOverhead: number | null;
}

// 判定调用是否为规划目的：plan / replan 前缀匹配，容忍未来扩展（如 plan-refine）
function isPlanningPurpose(purpose: string | undefined): boolean {
  return purpose === "plan" || purpose === "replan";
}

// 规划开销观测：PlanningOverhead = PlanningTokens / TotalTokens
export class PlanningEvaluator implements Evaluator<PlanningDetails> {
  name = "planning";

  async evaluate(
    context: EvaluationContext
  ): Promise<EvaluationResult<PlanningDetails>> {
    const { trace } = context;

    let modelCalls = 0;
    let plansCreated = 0;
    let planRevisions = 0;
    let planningTokens = 0;
    let totalTokens = 0;
    // 单槽配对：模型调用严格串行，model_call 之后首个 model_response 即其响应
    let pendingPurpose: string | undefined;

    for (const step of trace.steps) {
      switch (step.kind) {
        case "model_call":
          modelCalls += 1;
          pendingPurpose = step.purpose;
          break;
        case "model_response":
          totalTokens += step.usage.totalTokens;
          if (isPlanningPurpose(pendingPurpose)) {
            planningTokens += step.usage.totalTokens;
          }
          pendingPurpose = undefined;
          break;
        case "plan_created":
          plansCreated += 1;
          break;
        case "plan_updated":
          if (step.change === "revised") planRevisions += 1;
          break;
        default:
          break;
      }
    }

    return {
      evaluator: this.name,
      // 纯观测不定义绝对分
      score: 1,
      passed: true,
      details: {
        modelCalls,
        plansCreated,
        planRevisions,
        planningTokens,
        totalTokens,
        planningOverhead:
          totalTokens > 0 ? planningTokens / totalTokens : null
      }
    };
  }
}
