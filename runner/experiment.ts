// 实验调度器：Task × Agent × Model × Runs 的组合即一个 Experiment（一级对象）
// 负责：初始化环境/Agent → 逐 run 执行 → Run 级评估 → stability 聚合 → 统一落盘
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Evaluator, EvaluationResult, RunSummary } from "../core/evaluator.js";
import type { Model } from "../core/model.js";

import { benchmark, type BenchmarkOptions, type BenchmarkReport } from "./benchmark.js";
import { StabilityEvaluator, type StabilityDetails } from "../evaluators/stability/stability_evaluator.js";

// 实验目录约定：results/experiments/exp_xxxx/{config.json, summary.json, runs/run_001.json…}
export const EXPERIMENTS_DIR = path.resolve("results", "experiments");

// 实验配置
export interface ExperimentOptions {
  // 任务 id
  task: string;
  // 架构 id
  agent: string;
  // 模型（厂商 id / "provider:model" / Model 实例）
  model: string | Model;
  // 重复运行次数
  runs: number;
  // 架构自定义参数
  agentOptions?: Record<string, unknown>;
  // Run 级评估器链（缺省 success + efficiency + cost）
  runEvaluators?: Evaluator[];
  // 实验根目录，默认 results/experiments
  outDir?: string;
}

// 实验报告：Experiment 是一级对象，summary 由 Run 摘要聚合而来
export interface ExperimentReport {
  experimentId: string;
  config: {
    task: string;
    agent: string;
    // 模型描述（实例时为 provider=instance + 模型名）
    model: string;
    modelProvider: string;
    runs: number;
    createdAt: string;
  };
  // 各 run 的成功评估结果（success 评估器视角）
  summary: {
    stability: EvaluationResult<StabilityDetails>;
    runSummaries: RunSummary[];
  };
  // 全量单次报告（含 trace），落盘于 runs/ 子目录
  runs: BenchmarkReport[];
}

// 从单次报告派生轻量 Run 摘要（不含 trace）
function toRunSummary(report: BenchmarkReport): RunSummary {
  return {
    runId: report.runId,
    agentName: report.agent.name,
    modelName: report.model.name,
    success: report.result.success,
    error: report.result.error,
    durationMs: report.metrics.durationMs,
    usage: {
      promptTokens: report.metrics.inputTokens,
      completionTokens: report.metrics.outputTokens,
      totalTokens: report.metrics.inputTokens + report.metrics.outputTokens
    },
    evaluations: report.evaluations
  };
}

// 跑一个实验：同一 Task × Agent × Model 组合重复 runs 次，聚合 stability
export async function runExperiment(options: ExperimentOptions): Promise<ExperimentReport> {
  if (options.runs < 1) throw new Error(`runs 必须 >= 1，实际 ${options.runs}`);

  // 同一 model 描述在每次 run 中复用（Model 实例共享；ScriptedModel 每轮 reset）
  const runOptions: BenchmarkOptions = {
    task: options.task,
    agent: options.agent,
    model: options.model,
    agentOptions: options.agentOptions,
    // 单次结果由本调度器统一落盘到实验目录
    outDir: null
  };

  const reports: BenchmarkReport[] = [];
  for (let i = 1; i <= options.runs; i++) {
    // 剧本回放等有状态模型在每轮开始前归零（真实模型无 reset 方法，跳过）
    // planner-executor 的独立规划模型同理
    const resettable = (candidate: unknown): void => {
      if (
        candidate !== null &&
        typeof candidate === "object" &&
        typeof (candidate as { reset?: unknown }).reset === "function"
      ) {
        (candidate as { reset: () => void }).reset();
      }
    };
    resettable(options.model);
    resettable(options.agentOptions?.plannerModel);
    const modelLabel =
      typeof options.model === "string" ? options.model : options.model.name;
    console.log(
      `[experiment] run ${i}/${options.runs}: ${options.task} × ${options.agent} × ${modelLabel}`
    );
    const report = await benchmark(runOptions, options.runEvaluators);
    reports.push(report);
  }

  // Experiment 级评估：stability = f(run_1, ..., run_n)
  const runSummaries = reports.map(toRunSummary);
  const modelDesc =
    typeof options.model === "string" ? options.model : `instance:${options.model.name}`;
  const stability = await new StabilityEvaluator().evaluate({
    task: {
      taskId: reports[0]?.task.id ?? options.task,
      category: reports[0]?.task.category ?? "unknown"
    },
    agentId: options.agent,
    modelId: modelDesc,
    runs: runSummaries
  });

  const experiment: ExperimentReport = {
    experimentId: `exp_${randomUUID().slice(0, 8)}`,
    config: {
      task: options.task,
      agent: options.agent,
      model: modelDesc,
      modelProvider: reports[0]?.model.provider ?? "unknown",
      runs: options.runs,
      createdAt: new Date().toISOString()
    },
    summary: { stability, runSummaries },
    runs: reports
  };

  // 落盘：exp 目录 + config/summary/runs
  const expDir = path.join(options.outDir ?? EXPERIMENTS_DIR, experiment.experimentId);
  const runsDir = path.join(expDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    path.join(expDir, "config.json"),
    JSON.stringify(experiment.config, null, 2),
    "utf-8"
  );
  writeFileSync(
    path.join(expDir, "summary.json"),
    JSON.stringify(
      { experimentId: experiment.experimentId, config: experiment.config, summary: experiment.summary },
      null,
      2
    ),
    "utf-8"
  );
  for (let i = 0; i < reports.length; i++) {
    writeFileSync(
      path.join(runsDir, `run_${String(i + 1).padStart(3, "0")}.json`),
      JSON.stringify(reports[i], null, 2),
      "utf-8"
    );
  }
  console.log(`[experiment] ${experiment.experimentId} 已写入 ${expDir}`);

  return experiment;
}
