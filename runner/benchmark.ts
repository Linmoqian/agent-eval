// 基准测试入口：Task → Agent → Model → Trace → Evaluator → Result 完整链路
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Agent } from "../core/agent.js";
import type { Evaluator, EvaluationResult } from "../core/evaluator.js";
import type { Model } from "../core/model.js";
import { validateTask, type Task, type Tool } from "../core/index.js";
import type { Trace } from "../core/trace.js";
import { loadEnvFile } from "../core/env.js";

import { RawAgent } from "../agents/raw/raw_agent.js";
import { ToolLoopAgent } from "../agents/tool-loop/tool_loop_agent.js";
import { ReactAgent } from "../agents/react/react_agent.js";
import { PlanExecuteAgent } from "../agents/plan-execute/plan_execute_agent.js";
import { PlannerExecutorAgent } from "../agents/planner-executor/planner_executor_agent.js";
import { createCompatibleModel, listProviders } from "../models/openai-compatible/openai_compatible.js";
import { SuccessEvaluator } from "../evaluators/success/success_evaluator.js";
import { EfficiencyEvaluator } from "../evaluators/efficiency/efficiency_evaluator.js";
import { CostEvaluator } from "../evaluators/cost/cost_evaluator.js";
import { ToolUsageEvaluator } from "../evaluators/behavior/tool_usage.js";
import { PlanningEvaluator } from "../evaluators/behavior/planning.js";
import { ErrorsEvaluator } from "../evaluators/behavior/errors.js";
import { RobustnessEvaluator } from "../evaluators/robustness/robustness_evaluator.js";
import { resolveFaultProfile } from "../core/fault.js";
import { wrapToolsWithFaults } from "../environments/fault_injector.js";
import { createRobotWorldTools } from "../environments/robot_world/env.js";
import { createKVTools } from "../environments/kv_store/env.js";

// 项目根（dist/runner → 上一级两级），任务与结果目录都相对它定位
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TASKS_DIR = path.join(PROJECT_ROOT, "tasks");
const RESULTS_DIR = path.join(PROJECT_ROOT, "results");

// benchmark 调用参数
export interface BenchmarkOptions {
  // 任务 id，如 "robot_path_001"，在 tasks/ 下按文件名查找
  task: string;
  // 架构名："raw" | "tool-loop" | "react" | "plan-execute" | "planner-executor"
  agent: string;
  // 架构自定义参数（如 planner-executor 的 plannerModel），透传给 agent.init
  agentOptions?: Record<string, unknown>;
  // 模型：厂商 id（如 "openai"/"deepseek"/"glm"）或 "provider:model"，也可直接传 Model 实例
  model: string | Model;
  // 结果落盘目录，默认 results/；传 null 不落盘（实验调度器自行组织目录）
  outDir?: string | null;
  // 故障注入实验条件（M7）：profile 名或 "profile:seed"，如 "medium" / "medium:42"；缺省不注入
  fault?: string;
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
  // Run 级评估结果（success / efficiency / cost …）
  evaluations: EvaluationResult[];
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

// 按任务类别/输入装配工具环境：planning/robotics → robot_world，tool-use → kv_store；故障条件在环境侧包装实施
function loadTools(task: Task, fault?: string): Tool[] {
  let tools: Tool[] = [];
  if (task.category === "planning" || task.category === "robotics") {
    if (typeof task.input.map === "string") {
      tools = createRobotWorldTools(task.input.map);
    }
  } else if (task.input.store === "kv") {
    const initial =
      typeof task.input.initial === "object" && task.input.initial !== null
        ? (task.input.initial as Record<string, unknown>)
        : {};
    tools = createKVTools(initial);
  }
  if (fault !== undefined && fault !== "clean") {
    const resolved = resolveFaultProfile(fault);
    tools = wrapToolsWithFaults(tools, resolved.config, resolved.seed);
  }
  return tools;
}

// 架构注册表：新增架构只需在此登记
export const AGENT_IDS = [
  "raw",
  "tool-loop",
  "react",
  "plan-execute",
  "planner-executor"
] as const;

function resolveAgent(name: string): Agent {
  switch (name) {
    case "raw":
      return new RawAgent();
    case "tool-loop":
      return new ToolLoopAgent();
    case "react":
      return new ReactAgent();
    case "plan-execute":
      return new PlanExecuteAgent();
    case "planner-executor":
      return new PlannerExecutorAgent();
    default:
      throw new Error(`未注册的 Agent 架构: ${name}（可用: ${AGENT_IDS.join(", ")}）`);
  }
}

// 模型解析：厂商 id / "provider:model" 走兼容适配器，其余须传实例
function resolveModel(model: string | Model): { provider: string; instance: Model } {
  if (typeof model !== "string") {
    return { provider: "instance", instance: model };
  }
  const sep = model.indexOf(":");
  const providerId = sep === -1 ? model : model.slice(0, sep);
  const modelOverride = sep === -1 ? undefined : model.slice(sep + 1);
  try {
    const instance = createCompatibleModel(providerId, modelOverride);
    return { provider: providerId, instance };
  } catch (err) {
    // 非注册厂商且非实例：给出可用列表
    throw new Error(`${String(err)}；也可直接传入 Model 实例（可用厂商: ${listProviders().join(", ")}）`);
  }
}

// 从 Trace 派生指标：观测层是唯一事实来源
function deriveMetrics(report: Omit<BenchmarkReport, "metrics">): BenchmarkReport["metrics"] {
  const toolCalls = report.trace.steps.filter((s) => s.kind === "tool_call").length;
  let inputTokens = 0;
  let outputTokens = 0;
  let lastTimestamp = 0;
  for (const step of report.trace.steps) {
    if (step.kind === "model_response") {
      inputTokens += step.usage.promptTokens;
      outputTokens += step.usage.completionTokens;
    }
    lastTimestamp = step.timestamp;
  }
  return {
    durationMs: lastTimestamp,
    inputTokens,
    outputTokens,
    toolCalls,
    steps: report.trace.steps.length
  };
}

// 默认 Run 级评估器链：success 裁决 + efficiency/cost 观测 + behavior 行为观测（M6）+ robustness（M7）
function defaultEvaluators(): Evaluator[] {
  return [
    new SuccessEvaluator(),
    new EfficiencyEvaluator(),
    new CostEvaluator(),
    new ToolUsageEvaluator(),
    new PlanningEvaluator(),
    new ErrorsEvaluator(),
    new RobustnessEvaluator()
  ];
}

// 单次完整评估：Agent 负责完成任务，Evaluator 负责评价任务，二者彻底解耦
export async function benchmark(
  options: BenchmarkOptions,
  evaluators: Evaluator[] = defaultEvaluators()
): Promise<BenchmarkReport> {
  // 统一加载项目根 .env（显式环境变量优先），确保真实模型调用能拿到 key
  loadEnvFile(path.join(PROJECT_ROOT, ".env"));

  const task = loadTask(options.task);
  const { provider, instance: model } = resolveModel(options.model);
  const agent = resolveAgent(options.agent);

  // 环境与 Agent 都按任务独立装配，保证每次运行状态干净（故障条件作为实验条件传入）
  const tools = loadTools(task, options.fault);
  await agent.init({ model, tools, options: options.agentOptions });

  const result = await agent.run(task);

  const evaluations: EvaluationResult[] = [];
  for (const evaluator of evaluators) {
    evaluations.push(
      await evaluator.evaluate({ task, result, trace: result.trace, modelName: model.name })
    );
  }

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
    evaluations,
    trace: result.trace
  };

  const report: BenchmarkReport = { ...partial, metrics: deriveMetrics(partial) };

  // 结果落盘（results/ 不入库）；outDir 为 null 时不落盘，由调用方自行组织
  if (options.outDir !== null) {
    const outDir = options.outDir ?? RESULTS_DIR;
    mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${report.runId}.json`);
    writeFileSync(outFile, JSON.stringify(report, null, 2), "utf-8");
    console.log(`结果已写入 ${outFile}`);
  }

  return report;
}
