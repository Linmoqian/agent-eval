// 错误行为评估器：从 Trace 派生错误次数与致命性，观测失败发生在哪里
// 观测型指标：错误多不必然失败（重规划可恢复），M7 故障注入后与 recovery 联合解读
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type {
  EvaluationContext,
  EvaluationResult,
  Evaluator
} from "../../core/evaluator.js";

// 错误明细：全部从 error 事件派生
export interface ErrorsDetails {
  // error 事件总数
  errors: number;
  // 致命错误数（fatal === true，直接终止本次 run）
  fatalErrors: number;
  // 错误消息样本（前 5 条，便于排障定位）
  messages: string[];
}

// 保留的消息样本条数上限
const MAX_MESSAGES = 5;

// 失败位置观测：错误计数只描述形态，是否真失败由 success 裁决
export class ErrorsEvaluator implements Evaluator<ErrorsDetails> {
  name = "errors";

  async evaluate(
    context: EvaluationContext
  ): Promise<EvaluationResult<ErrorsDetails>> {
    const { trace } = context;

    let errors = 0;
    let fatalErrors = 0;
    const messages: string[] = [];

    for (const step of trace.steps) {
      if (step.kind !== "error") continue;
      errors += 1;
      if (step.fatal === true) fatalErrors += 1;
      if (messages.length < MAX_MESSAGES) {
        messages.push(step.message);
      }
    }

    return {
      evaluator: this.name,
      // 纯观测不定义绝对分
      score: 1,
      // 仅致命错误视为不通过；可恢复错误正是行为差异的观测点
      passed: fatalErrors === 0,
      details: {
        errors,
        fatalErrors,
        messages
      }
    };
  }
}
