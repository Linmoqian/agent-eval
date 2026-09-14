// M2 架构矩阵验证：同一任务（robot_path_001）× 5 种架构 × ScriptedModel 离线全链路
// 验收：5 架构完整运行、行为全部进入统一 Trace、结构差异在事件流中可见
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { Trace } from "../core/trace.js";
import type { ToolUsageDetails } from "../evaluators/behavior/tool_usage.js";
import type { PlanningDetails } from "../evaluators/behavior/planning.js";
import type { ErrorsDetails } from "../evaluators/behavior/errors.js";

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

// 按名取评估明细并断言类型
function detailsOf<T>(r: BenchmarkReport, name: string): T {
  return evaluationOf(r, name).details as T;
}

// M6 行为对比表：全部从 Trace 派生，回答“都成功了，但成功方式为什么不同”
function printBehaviorTable(reports: BenchmarkReport[]): void {
  const rows: string[][] = [
    ["Architecture", "Success", "ToolCalls", "Duplicate", "Invalid", "Plans", "Replans"]
  ];
  for (const r of reports) {
    const success = evaluationOf(r, "success").score;
    const usage = detailsOf<ToolUsageDetails>(r, "tool-usage");
    const planning = detailsOf<PlanningDetails>(r, "planning");
    rows.push([
      r.agent.name,
      success.toFixed(2),
      String(usage.toolCalls),
      String(usage.duplicateToolCalls),
      String(usage.invalidToolCalls),
      String(planning.plansCreated),
      String(planning.planRevisions)
    ]);
  }
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  console.log("\n===== 架构行为对比（全部从 Trace 派生）=====");
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
  }
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

  // ===== M6 断言：行为指标从 Trace 自动派生且与剧本设计一致 =====
  const allReports = [rawReport, loopReport, reactReport, planReport, peReport];
  for (const r of allReports) {
    // 六个评估器全部在链上
    for (const name of ["success", "efficiency", "cost", "tool-usage", "planning", "errors"]) {
      expect(
        r.evaluations.some((e) => e.evaluator === name),
        `${r.agent.name}: 缺少 ${name} 评估器`
      );
    }
    // 行为指标与 efficiency 的交叉验证：toolCalls 口径一致
    const usage = detailsOf<ToolUsageDetails>(r, "tool-usage");
    const eff = detailsOf<{ toolCalls: number }>(r, "efficiency");
    expect(
      usage.toolCalls === eff.toolCalls,
      `${r.agent.name}: tool-usage 与 efficiency 的 toolCalls 不一致`
    );
  }

  const rawUsage = detailsOf<ToolUsageDetails>(rawReport, "tool-usage");
  const rawPlanning = detailsOf<PlanningDetails>(rawReport, "planning");
  expect(rawUsage.toolCalls === 0, `raw: 应无工具调用，实际 ${rawUsage.toolCalls}`);
  expect(rawPlanning.plansCreated === 0, "raw: 应无计划事件");

  const loopUsage = detailsOf<ToolUsageDetails>(loopReport, "tool-usage");
  expect(
    loopUsage.duplicateToolCalls === 2,
    `tool-loop: 盲循环应产生 2 次重复调用，实际 ${loopUsage.duplicateToolCalls}`
  );
  expect(loopUsage.invalidToolCalls === 0, "tool-loop: 剧本不应有无效调用");
  expect(
    loopUsage.toolRedundancy !== null && loopUsage.toolRedundancy > 0,
    "tool-loop: toolRedundancy 应为正值"
  );

  const reactUsage = detailsOf<ToolUsageDetails>(reactReport, "tool-usage");
  expect(
    reactUsage.duplicateToolCalls === 1,
    `react: 应产生 1 次重复调用，实际 ${reactUsage.duplicateToolCalls}`
  );
  expect(reactUsage.invalidToolCalls === 0, "react: 剧本不应有无效调用");

  const planUsage = detailsOf<ToolUsageDetails>(planReport, "tool-usage");
  const planPlanning = detailsOf<PlanningDetails>(planReport, "planning");
  expect(
    planUsage.duplicateToolCalls === 0 && planUsage.invalidToolCalls === 0,
    "plan-execute: 顺序执行不应有重复/无效调用"
  );
  expect(planPlanning.plansCreated === 1, "plan-execute: 应创建 1 份计划");
  expect(planPlanning.planRevisions === 0, "plan-execute: 不应发生计划修订");
  expect(
    planPlanning.planningOverhead !== null && planPlanning.planningOverhead > 0,
    "plan-execute: planningOverhead 应为正值"
  );

  const peUsage = detailsOf<ToolUsageDetails>(peReport, "tool-usage");
  const pePlanning = detailsOf<PlanningDetails>(peReport, "planning");
  const peErrors = detailsOf<ErrorsDetails>(peReport, "errors");
  expect(
    peUsage.invalidToolCalls === 1,
    `planner-executor: 障碍失败应计 1 次无效调用，实际 ${peUsage.invalidToolCalls}`
  );
  expect(
    peUsage.toolValidity !== null && peUsage.toolValidity < 1,
    "planner-executor: toolValidity 应小于 1"
  );
  expect(pePlanning.planRevisions === 1, "planner-executor: 应有 1 次计划修订");
  expect(
    pePlanning.planningOverhead !== null && pePlanning.planningOverhead > 0,
    "planner-executor: planningOverhead 应为正值"
  );
  expect(peErrors.fatalErrors === 0, "planner-executor: 失败应被重规划恢复，不应致命");

  // 行为对比表：M6 的验收载体
  printBehaviorTable(allReports);

  if (failures.length === 0) {
    console.log("\n✅ M2+M6 验证通过：5 架构完整运行，行为指标全部从 Trace 自动派生。");
    console.log("   raw=单次生成 | tool-loop=盲循环重复 | react=推理后重复确认 | plan-execute=顺序执行零冗余 | planner-executor=失败重规划恢复");
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
