// M1 链路验证：离线剧本模型跑通 Task→Agent→Model→Trace→Evaluator→Result 全链路
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import { benchmark } from "./benchmark.js";
import {
  ScriptedModel,
  scriptedToolCall,
  type ScriptedResponse
} from "../models/local/scripted_model.js";

// robot_path_001 的剧本解：scan + clear 障碍(4,2) → 依次 move 8 个目标 → 总结
// 障碍 (3,5) 不在目标路径上，无需清除，用于检验模型不会盲目调用
function buildToolLoopScript(): ScriptedResponse[] {
  const targets: [number, number][] = [
    [2, 1], [5, 3], [1, 6], [7, 7],
    [9, 2], [4, 8], [6, 5], [8, 9]
  ];
  return [
    { toolCalls: [scriptedToolCall("scan", {}), scriptedToolCall("clear", { x: 4, y: 2 })] },
    ...targets.map(([x, y]) => ({ toolCalls: [scriptedToolCall("move", { x, y })] })),
    { content: "已扫描地图、清除障碍并依次到达全部 8 个目标点，任务完成。" }
  ];
}

// 打印单次实验摘要
function printReport(title: string, r: Awaited<ReturnType<typeof benchmark>>): void {
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
}

async function main(): Promise<void> {
  console.log("M1 最小评估链路验证（ScriptedModel，离线）");

  // 对照组：raw 基线，无工具，模型只能给文本答案
  const rawReport = await benchmark({
    task: "robot_path_001",
    agent: "raw",
    model: new ScriptedModel(
      [{ content: "根据地图，应该依次访问 8 个目标点（规划建议，未实际执行）。" }],
      "scripted-raw"
    )
  });
  printReport("RawAgent（基线，无工具）", rawReport);

  // 实验组：tool-loop 按剧本执行完整工具链
  const loopReport = await benchmark({
    task: "robot_path_001",
    agent: "tool-loop",
    model: new ScriptedModel(buildToolLoopScript(), "scripted-loop")
  });
  printReport("ToolLoopAgent（工具循环）", loopReport);

  // 结论断言：评估器与 Agent 解耦后，裁决以 Trace 派生为准
  console.log("\n===== 结论 =====");
  console.log(
    `raw        自报成功=${rawReport.result.success}，实际通过=${rawReport.evaluation.passed}（完成 ${JSON.stringify(rawReport.evaluation.details)}）`
  );
  console.log(
    `tool-loop  自报成功=${loopReport.result.success}，实际通过=${loopReport.evaluation.passed}（完成 ${JSON.stringify(loopReport.evaluation.details)}）`
  );
  if (loopReport.evaluation.passed && !rawReport.evaluation.passed) {
    console.log("✅ M1 链路验证通过：Agent 声称 ≠ 任务完成，SuccessEvaluator 以 Trace 为准。");
  } else {
    console.error("❌ M1 链路验证未达预期，请检查上述输出。");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
