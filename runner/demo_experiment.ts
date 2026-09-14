// M4/M5 链路验证：Experiment 聚合层（多次 run → stability）+ 三评估器 + 实验目录结构
// 离线剧本模型验证，零网络请求
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { runExperiment } from "./experiment.js";
import { ScriptedModel } from "../models/local/scripted_model.js";
import { buildPlanExecuteScript, buildPlannerScripts } from "./scripts.js";

// 断言收集器
const failures: string[] = [];
function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

async function main(): Promise<void> {
  console.log("M4/M5 验证：Experiment 聚合层 + efficiency/cost/stability + 实验目录（离线）");

  // 实验 1：plan-execute × 3 runs（单实例剧本，调度器每轮 reset 后重放）
  const planExp = await runExperiment({
    task: "robot_path_001",
    agent: "plan-execute",
    model: new ScriptedModel(buildPlanExecuteScript(), "scripted-plan"),
    runs: 3
  });
  console.log(`\n[exp1] ${planExp.experimentId} plan-execute × scripted-plan × 3`);
  console.log(`stability   : ${JSON.stringify(planExp.summary.stability.details)}`);

  // 实验 2：planner-executor × 2 runs（planner/executor 双实例，均需每轮 reset）
  const { planner, executor } = buildPlannerScripts();
  const peExp = await runExperiment({
    task: "robot_path_001",
    agent: "planner-executor",
    model: new ScriptedModel(executor, "scripted-executor"),
    agentOptions: { plannerModel: new ScriptedModel(planner, "scripted-planner") },
    runs: 2
  });
  console.log(`\n[exp2] ${peExp.experimentId} planner-executor × scripted × 2`);
  console.log(`stability   : ${JSON.stringify(peExp.summary.stability.details)}`);

  // ===== 断言：stability 聚合 =====
  const planSt = planExp.summary.stability.details;
  expect(planSt.runs === 3, `exp1: runs 应为 3，实际 ${planSt.runs}`);
  expect(planSt.successRate === 1, `exp1: successRate 应为 1，实际 ${planSt.successRate}`);
  expect(
    planSt.perEvaluator["success"]?.scoreStd === 0,
    "exp1: 确定性重放 scoreStd 应为 0"
  );
  expect(planSt.latencyStdMs >= 0, "exp1: latencyStdMs 应非负");

  const peSt = peExp.summary.stability.details;
  expect(peSt.runs === 2 && peSt.successRate === 1, `exp2: 2 runs 全过，实际 ${peSt.runs}/${peSt.successRate}`);

  // ===== 断言：Run 级三评估器齐备 =====
  for (const run of planExp.runs) {
    const names = run.evaluations.map((e) => e.evaluator);
    for (const expected of ["success", "efficiency", "cost"]) {
      expect(names.includes(expected), `exp1 ${run.runId}: 缺少 ${expected} 评估器`);
    }
    // efficiency 观测正确性：20 次模型调用（1 plan + 18 执行 + 1 总结）
    const eff = run.evaluations.find((e) => e.evaluator === "efficiency") as
      | { details: { modelCalls: number } }
      | undefined;
    expect(eff?.details.modelCalls === 20, `exp1 ${run.runId}: modelCalls 应为 20`);
    // cost：scripted-* 不在价格表，应标记未定价而非报错
    const cost = run.evaluations.find((e) => e.evaluator === "cost") as
      | { details: { priced: boolean; estimatedCostUsd: number | null } }
      | undefined;
    expect(
      cost?.details.priced === false && cost?.details.estimatedCostUsd === null,
      `exp1 ${run.runId}: 未收录模型应 priced=false`
    );
  }

  // ===== 断言：实验目录结构 =====
  function checkExpDir(expId: string, runCount: number, label: string): void {
    const base = path.resolve("results", "experiments", expId);
    expect(existsSync(path.join(base, "config.json")), `${label}: 缺 config.json`);
    expect(existsSync(path.join(base, "summary.json")), `${label}: 缺 summary.json`);
    const runFiles = existsSync(path.join(base, "runs"))
      ? readdirSync(path.join(base, "runs")).filter((f) => f.startsWith("run_"))
      : [];
    expect(runFiles.length === runCount, `${label}: runs 文件数应 ${runCount}，实际 ${runFiles.length}`);
    expect(
      runFiles.includes(`run_${String(runCount).padStart(3, "0")}.json`),
      `${label}: 缺 run_${String(runCount).padStart(3, "0")}.json`
    );
    // summary.json 可解析且含 stability
    const summary = JSON.parse(readFileSync(path.join(base, "summary.json"), "utf-8")) as {
      summary: { stability: { evaluator: string; details: { runs: number } } };
    };
    expect(
      summary.summary.stability.evaluator === "stability" &&
        summary.summary.stability.details.runs === runCount,
      `${label}: summary.json 的 stability 不符`
    );
  }
  checkExpDir(planExp.experimentId, 3, "exp1");
  checkExpDir(peExp.experimentId, 2, "exp2");

  console.log("\n===== 结论 =====");
  if (failures.length === 0) {
    console.log("✅ M4/M5 验证通过：Experiment 聚合层、stability、efficiency/cost 观测、exp 目录结构均正常。");
  } else {
    console.error("❌ M4/M5 验证未达预期：");
    for (const f of failures) console.error(`   - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
