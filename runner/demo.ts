// M2 架构矩阵验证：同一任务（robot_path_001）× 5 种架构 × ScriptedModel 离线全链路
// 验收：5 架构完整运行、行为全部进入统一 Trace、结构差异在事件流中可见
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { Trace } from "../core/trace.js";

import { benchmark, type BenchmarkReport } from "./benchmark.js";
import { ScriptedModel } from "../models/local/scripted_model.js";
import {
  buildRawScript,
  buildToolLoopScript,
  buildReactScript,
  buildPlanExecuteScript,
  buildPlannerScripts
} from "./scripts.js";

// 统计事件类型分布，直观展示各架构的结构差异
function eventKindCounts(trace: Trace): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const step of trace.steps) {
    counts[step.kind] = (counts[step.kind] ?? 0) + 1;
  }
  return counts;
}

// 打印单次实验摘要
function printReport(title: string, r: BenchmarkReport): void {
  console.log(`\n===== ${title} =====`);
  console.log(`runId        : ${r.runId}`);
  console.log(`task         : ${r.task.id} (${r.task.category})`);
  console.log(`agent        : ${r.agent.name}`);
  console.log(`model        : ${r.model.provider}/${r.model.name}`);
  console.log(`agent 自报   : success=${r.result.success}`);
  for (const e of r.evaluations) {
    console.log(
      `evaluator    : ${e.evaluator} passed=${e.passed} score=${e.score.toFixed(2)} details=${JSON.stringify(e.details)}`
    );
  }
  console.log(
    `metrics      : ${r.metrics.steps} steps, ${r.metrics.toolCalls} toolCalls, ${r.metrics.inputTokens}+${r.metrics.outputTokens} tokens, ${r.metrics.durationMs}ms`
  );
  console.log(`events       : ${JSON.stringify(eventKindCounts(r.trace))}`);
}

// 按名取 Run 级评估结果
function evaluationOf(r: BenchmarkReport, name: string): { passed: boolean; score: number; details: unknown } {
  const found = r.evaluations.find((e) => e.evaluator === name);
  if (found === undefined) throw new Error(`${r.agent.name}: 缺少 ${name} 评估结果`);
  return { passed: found.passed, score: found.score, details: found.details };
}

// 断言收集器：失败信息汇总后统一判定
const failures: string[] = [];
function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function expectTraceIntegrity(r: BenchmarkReport): void {
  expect(r.trace.steps.length > 0, `${r.agent.name}: trace 为空`);
  expect(
    r.trace.steps.some((s) => s.kind === "model_call"),
    `${r.agent.name}: 缺少 model_call 事件`
  );
  expect(
    r.trace.steps.some((s) => s.kind === "model_response"),
    `${r.agent.name}: 缺少 model_response 事件`
  );
}

async function main(): Promise<void> {
  console.log("M2 架构矩阵验证（ScriptedModel，离线）：raw / tool-loop / react / plan-execute / planner-executor");

  // 1. raw 基线：无工具，评估器应判不通过（对照组）
  const rawReport = await benchmark({
    task: "robot_path_001",
    agent: "raw",
    model: new ScriptedModel(buildRawScript(), "scripted-raw")
  });
  printReport("RawAgent（基线，单次生成）", rawReport);

  // 2. tool-loop：工具循环
  const loopReport = await benchmark({
    task: "robot_path_001",
    agent: "tool-loop",
    model: new ScriptedModel(buildToolLoopScript(), "scripted-loop")
  });
  printReport("ToolLoopAgent（工具循环）", loopReport);

  // 3. react：Thought → Action → Observation 交替
  const reactReport = await benchmark({
    task: "robot_path_001",
    agent: "react",
    model: new ScriptedModel(buildReactScript(), "scripted-react")
  });
  printReport("ReactAgent（Reason + Act）", reactReport);

  // 4. plan-execute：先规划后执行
  const planReport = await benchmark({
    task: "robot_path_001",
    agent: "plan-execute",
    model: new ScriptedModel(buildPlanExecuteScript(), "scripted-plan")
  });
  printReport("PlanExecuteAgent（先规划后执行）", planReport);

  // 5. planner-executor：双角色分离 + 失败重规划
  const { planner, executor } = buildPlannerScripts();
  const peReport = await benchmark({
    task: "robot_path_001",
    agent: "planner-executor",
    model: new ScriptedModel(executor, "scripted-executor"),
    agentOptions: { plannerModel: new ScriptedModel(planner, "scripted-planner") }
  });
  printReport("PlannerExecutorAgent（Planner/Executor 分离）", peReport);

  // ===== 结论断言 =====
  console.log("\n===== 结论 =====");

  // 完成度：4 个工具架构必须通过，raw 不通过
  expect(!evaluationOf(rawReport, "success").passed, "raw 基线不应通过（对照组）");
  for (const r of [loopReport, reactReport, planReport, peReport]) {
    expect(
      evaluationOf(r, "success").passed,
      `${r.agent.name}: 评估器应判通过，实际 ${JSON.stringify(evaluationOf(r, "success").details)}`
    );
    expectTraceIntegrity(r);
  }
  expectTraceIntegrity(rawReport);

  // 结构差异断言：事件流形态各不相同
  const reactThoughts = reactReport.trace.steps.filter(
    (s) => s.kind === "thought" && s.source === "model"
  ).length;
  expect(reactThoughts >= 10, `react: 应有显式 Thought 步骤，实际 ${reactThoughts}`);
  expect(
    loopReport.trace.steps.every((s) => s.kind !== "thought"),
    "tool-loop: 不应有 thought 事件（对照）"
  );

  const planCreated = planReport.trace.steps.filter((s) => s.kind === "plan_created").length;
  expect(planCreated === 1, `plan-execute: 应有 1 个 plan_created，实际 ${planCreated}`);
  expect(
    !planReport.trace.steps.some((s) => s.kind === "plan_updated" && s.change === "revised"),
    "plan-execute: 不应发生计划修订（顺序执行不回头）"
  );

  const peRevised = peReport.trace.steps.filter(
    (s) => s.kind === "plan_updated" && s.change === "revised"
  ).length;
  const peReplanning = peReport.trace.steps.filter(
    (s) => s.kind === "agent_state" && s.phase === "replanning"
  ).length;
  const peFailedObs = peReport.trace.steps.filter(
    (s) => s.kind === "tool_result" && !s.ok
  ).length;
  expect(peRevised === 1, `planner-executor: 应有 1 次计划修订，实际 ${peRevised}`);
  expect(peReplanning === 1, `planner-executor: 应有 1 次 replanning 状态，实际 ${peReplanning}`);
  expect(peFailedObs === 1, `planner-executor: 应有 1 次失败观测，实际 ${peFailedObs}`);
  expect(evaluationOf(peReport, "success").passed, "planner-executor: 重规划后应完成任务");

  if (failures.length === 0) {
    console.log("✅ M2 验证通过：5 架构完整运行，行为全部进入统一 Trace，结构差异可在事件流中观测。");
    console.log("   raw=单次生成 | tool-loop=工具循环 | react=Reason+Act | plan-execute=先规划后执行 | planner-executor=双角色分离+重规划");
  } else {
    console.error("❌ M2 验证未达预期：");
    for (const f of failures) console.error(`   - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
