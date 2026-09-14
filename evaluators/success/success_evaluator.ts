// 完成度评估器：按 ground_truth 模式裁决——targets（环境进度）/ state（状态快照）/ answer（答案匹配）
// Agent 自报结果仅作参考；环境观测与最终答案是唯一事实来源
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type {
  EvaluationContext,
  EvaluationResult,
  Evaluator
} from "../../core/evaluator.js";

// success 明细：三种模式共用一份结构，未涉及字段按模式省略
export interface SuccessDetails {
  // 判定模式：targets（环境进度）/ state（状态快照比对）/ answer（答案匹配）/ unknown（无 ground_truth）
  mode: "targets" | "state" | "answer" | "unknown";
  // targets 模式：Trace 中观察到的实际完成数
  completed?: number;
  // targets 模式：ground_truth 期望完成数
  expected?: number;
  // state 模式：期望键的匹配情况
  stateMatched?: Record<string, boolean>;
  // answer 模式：是否命中期望答案
  answerMatched?: boolean;
  // Agent 自报成功与否（对照组，非裁决依据）
  agentClaimed: boolean;
}

// 从一条 observation JSON 中提取任务进度：统一协议 progress_completed 优先，completed_targets 兼容
function extractCompleted(observation: string): number {
  try {
    const parsed = JSON.parse(observation) as {
      progress_completed?: unknown;
      completed_targets?: unknown;
    };
    for (const field of ["progress_completed", "completed_targets"] as const) {
      if (typeof parsed[field] === "number") {
        return parsed[field] as number;
      }
    }
  } catch {
    // 非 JSON 观测直接忽略
  }
  return -1;
}

// 从 observation 提取全量状态快照（kv_store 的 list / read 观测）
function extractState(observation: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(observation) as { state?: unknown };
    if (typeof parsed.state === "object" && parsed.state !== null) {
      return parsed.state as Record<string, unknown>;
    }
  } catch {
    // 非 JSON 观测直接忽略
  }
  return null;
}

// 值匹配：数值宽松（42 与 "42" 等价），其余按字符串严格比对
function valueMatches(actual: unknown, expected: unknown): boolean {
  const numA = Number(actual);
  const numE = Number(expected);
  if (
    actual !== null &&
    expected !== null &&
    !Number.isNaN(numA) &&
    !Number.isNaN(numE) &&
    String(actual).trim() !== "" &&
    String(expected).trim() !== ""
  ) {
    return numA === numE;
  }
  return String(actual) === String(expected);
}

// 答案匹配：期望数值 → 终答中任一提取数值相等；期望字符串 → 终答包含该串
function answerMatches(finalAnswer: string | null, expectedAnswer: unknown): boolean {
  if (typeof expectedAnswer === "number") {
    const numbers = (finalAnswer ?? "").match(/[-+]?\d+(?:\.\d+)?/g) ?? [];
    return numbers.some((n) => Number(n) === expectedAnswer);
  }
  return (finalAnswer ?? "").includes(String(expectedAnswer));
}

// 任务到底完成了没有：按 ground_truth 模式裁决，E = f(Task, Result, Trace)
export class SuccessEvaluator implements Evaluator<SuccessDetails> {
  name = "success";

  async evaluate(context: EvaluationContext): Promise<EvaluationResult<SuccessDetails>> {
    const { task, result, trace } = context;
    const gt = task.ground_truth ?? {};

    // ===== 模式 1：targets（环境进度派生，robot_world / planning / robotics）=====
    if (gt.targets !== undefined) {
      const completed = trace.steps.reduce(
        (best, step) =>
          step.kind === "tool_result" ? Math.max(best, extractCompleted(step.observation)) : best,
        -1
      );
      const finalCompleted = completed < 0 ? 0 : completed;
      const expected = Number(gt.targets);
      const passed = expected > 0 && finalCompleted >= expected;
      return {
        evaluator: this.name,
        score: expected > 0 ? Math.min(finalCompleted / expected, 1) : 0,
        passed,
        details: {
          mode: "targets",
          completed: finalCompleted,
          expected,
          agentClaimed: result.success
        }
      };
    }

    // ===== 模式 2：state（状态快照比对，kv_store / tool-use）=====
    if (gt.state !== undefined && typeof gt.state === "object") {
      const expectedState = gt.state as Record<string, unknown>;
      // 取最后出现的全量快照（或逐键 read 观测）合并
      const latest: Record<string, unknown> = {};
      for (const step of trace.steps) {
        if (step.kind !== "tool_result") continue;
        const snapshot = extractState(step.observation);
        if (snapshot !== null) {
          Object.assign(latest, snapshot);
        }
      }
      const stateMatched: Record<string, boolean> = {};
      let allMatched = true;
      for (const [key, expectedValue] of Object.entries(expectedState)) {
        const matched = key in latest && valueMatches(latest[key], expectedValue);
        stateMatched[key] = matched;
        if (!matched) allMatched = false;
      }
      return {
        evaluator: this.name,
        score: Object.keys(stateMatched).length > 0
          ? Object.values(stateMatched).filter(Boolean).length / Object.keys(stateMatched).length
          : 0,
        passed: allMatched,
        details: {
          mode: "state",
          stateMatched,
          agentClaimed: result.success
        }
      };
    }

    // ===== 模式 3：answer（终答匹配，reasoning）=====
    if (gt.answer !== undefined) {
      const answerMatched = answerMatches(result.finalAnswer, gt.answer);
      return {
        evaluator: this.name,
        score: answerMatched ? 1 : 0,
        passed: answerMatched,
        details: {
          mode: "answer",
          answerMatched,
          agentClaimed: result.success
        }
      };
    }

    // 无 ground_truth：无法裁决
    return {
      evaluator: this.name,
      score: 0,
      passed: false,
      details: {
        mode: "unknown",
        agentClaimed: result.success
      }
    };
  }
}
