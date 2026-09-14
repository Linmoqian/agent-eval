// 完成度评估器：从 Trace 派生实际完成数并与 ground_truth 比对，Agent 自报结果仅作参考
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type {
  EvaluationContext,
  EvaluationResult,
  Evaluator
} from "../../core/evaluator.js";

// success 明细
export interface SuccessDetails {
  // Trace 中观察到的实际完成数
  completed: number;
  // ground_truth 期望完成数
  expected: number;
  // Agent 自报成功与否（对照组，非裁决依据）
  agentClaimed: boolean;
}

// 从一条 observation JSON 中提取 completed_targets，无则返回 -1
function extractCompleted(observation: string): number {
  try {
    const parsed = JSON.parse(observation) as { completed_targets?: unknown };
    if (typeof parsed.completed_targets === "number") {
      return parsed.completed_targets;
    }
  } catch {
    // 非 JSON 观测直接忽略
  }
  return -1;
}

// 任务到底完成了没有：max(trace.completed_targets) >= ground_truth.targets
export class SuccessEvaluator implements Evaluator<SuccessDetails> {
  name = "success";

  async evaluate(context: EvaluationContext): Promise<EvaluationResult<SuccessDetails>> {
    const { task, result, trace } = context;

    // 环境观测是唯一事实来源，从 tool_result 事件逐步扫描取最大完成数
    const completed = trace.steps.reduce(
      (best, step) =>
        step.kind === "tool_result" ? Math.max(best, extractCompleted(step.observation)) : best,
      -1
    );
    const finalCompleted = completed < 0 ? 0 : completed;

    const expected = Number(task.ground_truth?.targets ?? 0);
    const passed = expected > 0 && finalCompleted >= expected;

    return {
      evaluator: this.name,
      // 完成比例
      score: expected > 0 ? Math.min(finalCompleted / expected, 1) : 0,
      passed,
      details: {
        completed: finalCompleted,
        expected,
        agentClaimed: result.success
      }
    };
  }
}
