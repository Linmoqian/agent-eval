// M2 架构矩阵验证：同一任务（robot_path_001）× 5 种架构 × ScriptedModel 离线全链路
// 验收：5 架构完整运行、行为全部进入统一 Trace、结构差异在事件流中可见
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { Trace } from "../core/trace.js";

import { benchmark, type BenchmarkReport } from "./benchmark.js";
import {
  ScriptedModel,
  scriptedToolCall,
  type ScriptedResponse
} from "../models/local/scripted_model.js";

// robot_path_001 的 8 个目标点
const TARGETS: [number, number][] = [
  [2, 1], [5, 3], [1, 6], [7, 7],
  [9, 2], [4, 8], [6, 5], [8, 9]
];

// ===== raw 剧本：无工具，模型只能给文本答案（对照组）=====
function buildRawScript(): ScriptedResponse[] {
  return [{ content: "根据地图，应该依次访问 8 个目标点（规划建议，未实际执行）。" }];
}

// ===== tool-loop 剧本：无显式推理，首轮并行调用两个工具 =====
function buildToolLoopScript(): ScriptedResponse[] {
  return [
    { toolCalls: [scriptedToolCall("scan", {}), scriptedToolCall("clear", { x: 4, y: 2 })] },
    ...TARGETS.map(([x, y]) => ({ toolCalls: [scriptedToolCall("move", { x, y })] })),
    { content: "已扫描地图、清除障碍并依次到达全部 8 个目标点，任务完成。" }
  ];
}

// ===== react 剧本：每轮 Thought 文本 + 恰好一个 Action =====
function buildReactScript(): ScriptedResponse[] {
  const script: ScriptedResponse[] = [
    {
      content: "Thought: 8 个目标点分布分散，先扫描确认地图布局与障碍。",
      toolCalls: [scriptedToolCall("scan", {})]
    },
    {
      content: "Thought: 障碍 (4,2) 在规划路径附近，先清除以防移动受阻。",
      toolCalls: [scriptedToolCall("clear", { x: 4, y: 2 })]
    }
  ];
  for (const [x, y] of TARGETS) {
    script.push({
      content: `Thought: 前往目标点 (${x},${y})，移动后即可标记完成。`,
      toolCalls: [scriptedToolCall("move", { x, y })]
    });
  }
  script.push({ content: "Thought: 全部 8 个目标点已到达，任务完成，输出总结。" });
  return script;
}

// ===== plan-execute 剧本：planning 出 JSON 计划 → 逐步执行（toolCall + DONE）→ 总结 =====
function buildPlanExecuteScript(): ScriptedResponse[] {
  const plan = JSON.stringify([
    "扫描地图获取机器人位置与目标状态",
    ...TARGETS.map(([x, y]) => `移动到目标点 (${x},${y})`)
  ]);
  const script: ScriptedResponse[] = [{ content: plan }];
  script.push({ toolCalls: [scriptedToolCall("scan", {})] });
  script.push({ content: "DONE" });
  for (const [x, y] of TARGETS) {
    script.push({ toolCalls: [scriptedToolCall("move", { x, y })] });
    script.push({ content: "DONE" });
  }
  script.push({ content: "计划全部步骤执行完毕，8 个目标点均已到达，任务完成。" });
  return script;
}

// ===== planner-executor 剧本：planner 与 executor 各自独立回放 =====
// planner 初版计划把障碍格 (4,2) 当途经点 → executor move 失败 → 回 planner 重规划 → 修正后完成
function buildPlannerScripts(): { planner: ScriptedResponse[]; executor: ScriptedResponse[] } {
  const planner: ScriptedResponse[] = [
    {
      content: JSON.stringify([
        "扫描地图获取机器人位置与目标状态",
        "途经 (4,2) 并移动到该格",
        ...TARGETS.map(([x, y]) => `移动到目标点 (${x},${y})`)
      ])
    },
    {
      content: JSON.stringify(TARGETS.map(([x, y]) => `移动到目标点 (${x},${y})`))
    }
  ];
  const executor: ScriptedResponse[] = [];
  executor.push({ toolCalls: [scriptedToolCall("scan", {})] });
  executor.push({ content: "DONE" });
  executor.push({ toolCalls: [scriptedToolCall("move", { x: 4, y: 2 })] }); // 将观测到 obstacle 失败
  for (const [x, y] of TARGETS) {
    executor.push({ toolCalls: [scriptedToolCall("move", { x, y })] });
    executor.push({ content: "DONE" });
  }
  executor.push({ content: "修订计划执行完毕，8 个目标点全部到达，任务完成。" });
  return { planner, executor };
}

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
  console.log(
    `evaluator    : passed=${r.evaluation.passed} score=${r.evaluation.score.toFixed(2)} details=${JSON.stringify(r.evaluation.details)}`
  );
  console.log(
    `metrics      : ${r.metrics.steps} steps, ${r.metrics.toolCalls} toolCalls, ${r.metrics.inputTokens}+${r.metrics.outputTokens} tokens, ${r.metrics.durationMs}ms`
  );
  console.log(`events       : ${JSON.stringify(eventKindCounts(r.trace))}`);
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
  expect(!rawReport.evaluation.passed, "raw 基线不应通过（对照组）");
  for (const r of [loopReport, reactReport, planReport, peReport]) {
    expect(r.evaluation.passed, `${r.agent.name}: 评估器应判通过，实际 ${JSON.stringify(r.evaluation.details)}`);
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
  expect(peReport.evaluation.passed, "planner-executor: 重规划后应完成任务");

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
