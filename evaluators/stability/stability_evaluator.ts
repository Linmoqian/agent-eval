// 稳定性评估器（Experiment 级）：作用于同一 Task×Agent×Model 的多次运行
// stability = f(run_1, ..., run_n)：成功率、分数均值/标准差、时延均值/标准差
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type {
  ExperimentContext,
  ExperimentEvaluator,
  EvaluationResult,
  RunSummary
} from "../../core/evaluator.js";

// 单个 Run 级评估器在多次运行上的聚合
export interface EvaluatorAggregate {
  // 通过率
  passRate: number;
  // 得分均值
  scoreMean: number;
  // 得分样本标准差（n < 2 时为 0）
  scoreStd: number;
}

// 稳定性明细
export interface StabilityDetails {
  // 运行次数
  runs: number;
  // 主评估器（success）的通过率，即稳定性核心度量
  successRate: number;
  // 各 Run 级评估器的聚合结果
  perEvaluator: Record<string, EvaluatorAggregate>;
  // 总时延均值/标准差（毫秒）
  latencyMeanMs: number;
  latencyStdMs: number;
  // token 总量均值/标准差
  tokensMean: number;
  tokensStd: number;
}

// 样本标准差（n - 1 分母），n < 2 时返回 0
function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

// 聚合某评估器在所有 run 上的结果
function aggregateEvaluator(runs: RunSummary[], evaluatorName: string): EvaluatorAggregate | null {
  const scores: number[] = [];
  let passed = 0;
  let seen = 0;
  for (const run of runs) {
    const evaluation = run.evaluations.find((e) => e.evaluator === evaluatorName);
    if (evaluation === undefined) continue;
    seen += 1;
    scores.push(evaluation.score);
    if (evaluation.passed) passed += 1;
  }
  if (seen === 0) return null;
  return {
    passRate: passed / seen,
    scoreMean: mean(scores),
    scoreStd: sampleStd(scores)
  };
}

// 稳定性 = 多次运行的一致性：成功率是核心，离散度记录在明细中
export class StabilityEvaluator implements ExperimentEvaluator<StabilityDetails> {
  name = "stability";

  async evaluate(context: ExperimentContext): Promise<EvaluationResult<StabilityDetails>> {
    const { runs } = context;

    // per-evaluator 聚合：以首个 run 出现的评估器为序
    const order: string[] = [];
    for (const run of runs) {
      for (const e of run.evaluations) {
        if (!order.includes(e.evaluator)) order.push(e.evaluator);
      }
    }
    const perEvaluator: Record<string, EvaluatorAggregate> = {};
    for (const name of order) {
      const agg = aggregateEvaluator(runs, name);
      if (agg !== null) perEvaluator[name] = agg;
    }

    // 主评估器取 success，缺省回退到第一个出现的评估器
    const primaryName = order.includes("success") ? "success" : order[0];
    const primary = primaryName !== undefined ? perEvaluator[primaryName] : undefined;
    const successRate = primary?.passRate ?? 0;

    const latencies = runs.map((r) => r.durationMs);
    const tokens = runs.map((r) => r.usage.totalTokens);

    return {
      evaluator: this.name,
      // 成功率即稳定性得分；离散度见 details（scoreStd / latencyStdMs）
      score: successRate,
      passed: successRate >= 1,
      details: {
        runs: runs.length,
        successRate,
        perEvaluator,
        latencyMeanMs: Math.round(mean(latencies)),
        latencyStdMs: Math.round(sampleStd(latencies)),
        tokensMean: Math.round(mean(tokens)),
        tokensStd: Math.round(sampleStd(tokens))
      }
    };
  }
}
