// 基准测试入口：Task → Agent → Model → Trace → Evaluator → Result 完整链路
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Agent } from "../core/agent.js";
import type { EvaluationResult } from "../core/evaluator.js";
import type { Model } from "../core/model.js";
import { validateTask, type Task, type Tool } from "../core/index.js";
import type { Trace } from "../core/trace.js";
import { loadEnvFile } from "../core/env.js";

import { RawAgent } from "../agents/raw/raw_agent.js";
import { ToolLoopAgent } from "../agents/tool-loop/tool_loop_agent.js";
import { OpenAIModel } from "../models/openai/openai_model.js";
import { SuccessEvaluator } from "../evaluators/success/success_evaluator.js";
import { createRobotWorldTools } from "../environments/robot_world/env.js";

// 项目根（dist/runner → 上一级两级），任务与结果目录都相对它定位
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TASKS_DIR = path.join(PROJECT_ROOT, "tasks");
const RESULTS_DIR = path.join(PROJECT_ROOT, "results");

// benchmark 调用参数
export interface BenchmarkOptions {
  // 任务 id，如 "robot_path_001"，在 tasks/ 下按文件名查找
  task: string;
  // 架构名："raw" | "tool-loop"
  agent: string;
  // 模型："openai" 走真实适配器；或直接传入 Model 实例（如 ScriptedModel）
  model: string | Model;
  // 结果落盘目录，默认 results/
  outDir?: string;
}

// 单次实验报告
export interface BenchmarkReport {
  runId: string;
  task: { id: string; category: string };
  agent: { name: string };
  model: { provider: string; name: string };
  result: {
    success: boolean;
    finalAnswer: string | null;
    error?: string;
  };
  // 全部从 Trace / AgentResult 派生，不经 Agent 之手
  metrics: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    steps: number;
  };
  evaluation: EvaluationResult;
  trace: Trace;
}

// 按 task_id 在 tasks/<category>/ 下查找并校验任务
export function loadTask(taskId: string): Task {
  for (const category of readdirSync(TASKS_DIR)) {
    const file = path.join(TASKS_DIR, category, `${taskId}.json`);
    try {
      const raw: unknown = JSON.parse(readFileSync(file, "utf-8"));
      return validateTask(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  throw new Error(`任务不存在: ${taskId}（在 ${TASKS_DIR} 下未找到）`);
}

// 按任务类别装配工具环境：M1 仅 planning → robot_world
function loadTools(task: Task): Tool[] {
  if (task.category === "planning" && typeof task.input.map === "string") {
    return createRobotWorldTools(task.input.map);
  }
  return [];
}

// 架构注册表：新增架构只需在此登记
function resolveAgent(name: string): Agent {
  switch (name) {
    case "raw":
      return new RawAgent();
    case "tool-loop":
      return new ToolLoopAgent();
    default:
      throw new Error(`未注册的 Agent 架构: ${name}`);
  }
}

// 模型解析："openai" 走真实适配器，其余须传实例
function resolveModel(model: string | Model): { provider: string; instance: Model } {
  if (typeof model !== "string") {
    return { provider: "instance", instance: model };
  }
  if (model === "openai") {
    return { provider: "openai", instance: new OpenAIModel() };
  }
  throw new Error(`未注册的模型: ${model}`);
}

// 从 Trace 派生指标：观测层是唯一事实来源
function deriveMetrics(report: Omit<BenchmarkReport, "metrics">): BenchmarkReport["metrics"] {
  const toolCalls = report.trace.steps.filter((s) => s.kind === "action").length;
  const inputTokens = report.trace.steps.reduce(
    (sum, s) => sum + (s.usage?.promptTokens ?? 0),
    0
  );
  const outputTokens = report.trace.steps.reduce(
    (sum, s) => sum + (s.usage?.completionTokens ?? 0),
    0
  );
  return {
    durationMs: report.trace.steps.length > 0
      ? report.trace.steps[report.trace.steps.length - 1].timestamp
      : 0,
    inputTokens,
    outputTokens,
    toolCalls,
    steps: report.trace.steps.length
  };
}

// 单次完整评估：Agent 负责完成任务，Evaluator 负责评价任务，二者彻底解耦
export async function benchmark(options: BenchmarkOptions): Promise<BenchmarkReport> {
  // 统一加载项目根 .env（显式环境变量优先），确保真实模型调用能拿到 key
  loadEnvFile(path.join(PROJECT_ROOT, ".env"));

  const task = loadTask(options.task);
  const { provider, instance: model } = resolveModel(options.model);
  const agent = resolveAgent(options.agent);

  // 环境与 Agent 都按任务独立装配，保证每次运行状态干净
  const tools = loadTools(task);
  await agent.init({ model, tools });

  const result = await agent.run(task);

  const evaluator = new SuccessEvaluator();
  const evaluation = await evaluator.evaluate({ task, result, trace: result.trace });

  const partial: Omit<BenchmarkReport, "metrics"> = {
    runId: `run_${randomUUID().slice(0, 8)}`,
    task: { id: task.task_id, category: task.category },
    agent: { name: agent.name },
    model: { provider, name: model.name },
    result: {
      success: result.success,
      finalAnswer: result.finalAnswer,
      error: result.error
    },
    evaluation,
    trace: result.trace
  };

  const report: BenchmarkReport = { ...partial, metrics: deriveMetrics(partial) };

  // 结果落盘（results/ 不入库）
  const outDir = options.outDir ?? RESULTS_DIR;
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${report.runId}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2), "utf-8");
  console.log(`结果已写入 ${outFile}`);

  return report;
}
