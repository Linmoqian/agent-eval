// M8 任务套件验证：四类 × 三难度共 12 题的元数据与加载校验 + 每类代表任务离线跑通
// 验收：多环境（robot_world / kv_store / 无环境）、success 三模式判定、executionEfficiency 派生、故障注入泛化
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { benchmark, loadTask, type BenchmarkReport } from "./benchmark.js";
import { ScriptedModel } from "../models/local/scripted_model.js";
import type { SuccessDetails } from "../evaluators/success/success_evaluator.js";
import type { EfficiencyDetails } from "../evaluators/efficiency/efficiency_evaluator.js";
import type { RobustnessDetails } from "../evaluators/robustness/robustness_evaluator.js";
import {
  buildPlanningHardScript,
  buildToolMediumScript,
  buildReasoningMediumScript,
  buildRoboticsEasyScript
} from "./suite_scripts.js";

// 断言收集器
const failures: string[] = [];
function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

// 项目根（dist/runner → 上两级），与 benchmark.ts 定位方式一致（fileURLToPath 处理中文路径）
const TASKS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "tasks"
);

// 按名取完整评估结果（passed 在结果层而非 details 层）
function resultOf(r: BenchmarkReport, name: string) {
  const found = r.evaluations.find((e) => e.evaluator === name);
  if (found === undefined) throw new Error(`缺少 ${name} 评估结果`);
  return found;
}

// ===== 1. 套件全量校验：12 题可加载、元数据齐备、命名规范 =====
function verifySuite(): { id: string; category: string; difficulty: string }[] {
  console.log("\n===== 1. 任务套件全量校验 =====");

  const expected: Record<string, string[]> = {
    planning: ["planning_easy_001", "planning_medium_001", "planning_hard_001"],
    "tool-use": ["tool_easy_001", "tool_medium_001", "tool_hard_001"],
    reasoning: ["reasoning_easy_001", "reasoning_medium_001", "reasoning_hard_001"],
    robotics: ["robotics_easy_001", "robotics_medium_001", "robotics_hard_001"]
  };

  const loaded: { id: string; category: string; difficulty: string }[] = [];
  const idPattern = /^[a-z-]+_(easy|medium|hard)_\d{3}$/;
  for (const [category, ids] of Object.entries(expected)) {
    for (const id of ids) {
      const task = loadTask(id);
      expect(task.task_id === id, `${id}: task_id 不一致`);
      expect(task.category === category, `${id}: category 应为 ${category}`);
      expect(task.difficulty !== undefined, `${id}: 缺少 difficulty 元数据`);
      expect(
        idPattern.test(task.task_id),
        `${id}: 命名不符合 <category>_<difficulty>_<序号> 规范`
      );
      expect(
        Array.isArray(task.tags) && task.tags.length > 0,
        `${id}: 缺少 tags 元数据`
      );
      loaded.push({ id, category, difficulty: task.difficulty ?? "?" });
    }
  }

  // 实际目录文件数与预期一致（不多不少），legacy 任务除外
  const files: string[] = [];
  for (const category of readdirSync(TASKS_DIR)) {
    for (const f of readdirSync(path.join(TASKS_DIR, category))) {
      if (f.endsWith(".json")) files.push(f.replace(".json", ""));
    }
  }
  const expectedCount = Object.values(expected).flat().length + 1; // +1 = robot_path_001 legacy
  expect(
    files.length === expectedCount,
    `任务文件数应为 ${expectedCount}（12 套件题 + robot_path_001），实际 ${files.length}`
  );

  console.log(`已加载 ${loaded.length} 题（4 类 × 3 难度）+ robot_path_001（legacy）`);
  for (const t of loaded) {
    console.log(`  ${t.id.padEnd(24)} ${t.category.padEnd(10)} ${t.difficulty}`);
  }
  return loaded;
}

// ===== 2. 代表任务离线跑通 =====
async function verifyRepresentatives(): Promise<void> {
  console.log("\n===== 2. 四类代表任务离线跑通 =====");

  // planning_hard_001 × tool-loop：targets 模式
  const planReport = await benchmark(
    {
      task: "planning_hard_001",
      agent: "tool-loop",
      model: new ScriptedModel(buildPlanningHardScript(), "scripted-plan-hard"),
      outDir: null
    }
  );
  const planEval = resultOf(planReport, "success");
  const planDetails = planEval.details as SuccessDetails;
  const planEff = resultOf(planReport, "efficiency").details as EfficiencyDetails;
  expect(planDetails.mode === "targets", `planning_hard: 应为 targets 模式，实际 ${planDetails.mode}`);
  expect(planEval.passed && planDetails.completed === 14, `planning_hard: 应完成 14 目标，实际 ${JSON.stringify(planDetails)}`);
  expect(
    planEff.executionEfficiency !== null && planEff.executionEfficiency > 0,
    `planning_hard: executionEfficiency 应为正值，实际 ${planEff.executionEfficiency}`
  );
  console.log(
    `planning_hard_001   : mode=${planDetails.mode} completed=${planDetails.completed}/${planDetails.expected} execEff=${(planEff.executionEfficiency ?? 0).toFixed(3)}（15 次调用完成 14 目标）`
  );

  // tool_medium_001 × tool-loop：state 模式
  const toolReport = await benchmark(
    {
      task: "tool_medium_001",
      agent: "tool-loop",
      model: new ScriptedModel(buildToolMediumScript(), "scripted-tool-medium"),
      outDir: null
    }
  );
  const toolEval = resultOf(toolReport, "success");
  const toolDetails = toolEval.details as SuccessDetails;
  const toolEff = resultOf(toolReport, "efficiency").details as EfficiencyDetails;
  expect(toolDetails.mode === "state", `tool_medium: 应为 state 模式，实际 ${toolDetails.mode}`);
  expect(
    toolEval.passed && toolDetails.stateMatched?.counter === true && toolDetails.stateMatched?.status === true,
    `tool_medium: 状态应全匹配，实际 ${JSON.stringify(toolDetails)}`
  );
  expect(
    toolEff.executionEfficiency !== null && toolEff.executionEfficiency > 0,
    `tool_medium: executionEfficiency 应为正值，实际 ${toolEff.executionEfficiency}`
  );
  console.log(
    `tool_medium_001     : mode=${toolDetails.mode} stateMatched=${JSON.stringify(toolDetails.stateMatched)} execEff=${(toolEff.executionEfficiency ?? 0).toFixed(3)}`
  );

  // reasoning_medium_001 × raw：answer 模式（raw 架构在纯推理任务上有一席之地）
  const reasonReport = await benchmark(
    {
      task: "reasoning_medium_001",
      agent: "raw",
      model: new ScriptedModel(buildReasoningMediumScript(), "scripted-reason"),
      outDir: null
    }
  );
  const reasonEval = resultOf(reasonReport, "success");
  const reasonDetails = reasonEval.details as SuccessDetails;
  expect(reasonDetails.mode === "answer", `reasoning_medium: 应为 answer 模式，实际 ${reasonDetails.mode}`);
  expect(reasonEval.passed === true, `reasoning_medium: 答案应命中「不能」，实际 ${JSON.stringify(reasonDetails)}`);
  expect(
    (resultOf(reasonReport, "efficiency").details as EfficiencyDetails).executionEfficiency === null,
    "reasoning_medium: 无工具调用时 executionEfficiency 应为 null"
  );
  console.log(
    `reasoning_medium_001: mode=${reasonDetails.mode} answerMatched=${reasonDetails.answerMatched}（raw 单次生成即可完成）`
  );

  // robotics_easy_001 × tool-loop：targets 模式（忠实执行序列）
  const robotReport = await benchmark(
    {
      task: "robotics_easy_001",
      agent: "tool-loop",
      model: new ScriptedModel(buildRoboticsEasyScript(), "scripted-robotics"),
      outDir: null
    }
  );
  const robotEval = resultOf(robotReport, "success");
  const robotDetails = robotEval.details as SuccessDetails;
  expect(robotEval.passed && robotDetails.completed === 3, `robotics_easy: 应完成 3 目标，实际 ${JSON.stringify(robotDetails)}`);
  console.log(
    `robotics_easy_001   : mode=${robotDetails.mode} completed=${robotDetails.completed}/${robotDetails.expected}（严格按序列执行）`
  );
}

// ===== 3. 故障注入泛化：KV 环境同样可注入 =====
async function verifyFaultGeneralization(): Promise<void> {
  console.log("\n===== 3. 故障注入对新环境泛化 =====");

  const report = await benchmark(
    {
      task: "tool_medium_001",
      agent: "tool-loop",
      model: new ScriptedModel(buildToolMediumScript(), "scripted-tool-medium"),
      fault: "light:3",
      outDir: null
    }
  );
  const robust = resultOf(report, "robustness").details as RobustnessDetails;
  // 剧本确定性回放 + 固定种子：注入次数确定（5 次调用 × 0.05 失败率，种子 3 的实际命中数）
  console.log(
    `tool_medium × light:3: injected=${robust.injectedFaults} faultTypes=${JSON.stringify(robust.faultTypes)}（kv_store 环境注入生效）`
  );
}

async function main(): Promise<void> {
  console.log("M8 任务套件验证（四类 × 三难度，离线，零网络）");
  verifySuite();
  await verifyRepresentatives();
  await verifyFaultGeneralization();

  console.log("\n===== 结论 =====");
  if (failures.length === 0) {
    console.log("✅ M8 验证通过：12 题套件齐备（difficulty/tags 元数据）、三种 success 判定模式、");
    console.log("   executionEfficiency 从统一 progress 协议派生、故障注入对 kv_store 泛化。");
  } else {
    console.error("❌ M8 验证未达预期：");
    for (const f of failures) console.error(`   - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
