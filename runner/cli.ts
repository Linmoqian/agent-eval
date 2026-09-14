// 实验矩阵 CLI：tasks × agents × models × runs 全组合调度，Experiment 为一级对象
// 用法：node dist/runner/cli.js --tasks robot_path_001 --agents raw,react --models deepseek,openai --runs 10
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import { runExperiment, EXPERIMENTS_DIR, type ExperimentReport } from "./experiment.js";
import { AGENT_IDS } from "./benchmark.js";
import { createCompatibleModel } from "../models/openai-compatible/openai_compatible.js";

// 解析 --key value 形式的命令行参数
function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = value;
      i += 1;
    }
  }
  return parsed;
}

// 逗号分隔参数切分
function splitList(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim().length === 0) return fallback;
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

// 按列宽对齐打印表格
function printTable(rows: string[][]): void {
  const colCount = rows[0]?.length ?? 0;
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    widths[c] = Math.max(...rows.map((r) => r[c]?.length ?? 0));
  }
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tasks = splitList(args.tasks, []);
  const agents = splitList(args.agents, ["raw"]);
  const models = splitList(args.models, ["openai"]);
  const runs = Number(args.runs ?? "1");
  const outDir = args.out !== undefined ? args.out : EXPERIMENTS_DIR;

  if (tasks.length === 0) {
    console.error(
      [
        "用法：node dist/runner/cli.js --tasks <ids> [--agents <ids>] [--models <ids>] [--runs <n>] [--out <dir>]",
        "",
        "  --tasks   必填，逗号分隔，如 robot_path_001",
        "  --agents  缺省 raw；可选 raw,tool-loop,react,plan-execute,planner-executor",
        "  --models  缺省 openai；厂商 id 或 provider:model，如 deepseek,zhipu:glm-4.5-air",
        "  --runs    缺省 1",
        "  --out     缺省 results/experiments"
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(runs) || runs < 1) {
    console.error(`--runs 必须是正整数，实际 ${args.runs}`);
    process.exitCode = 1;
    return;
  }
  const unknownAgents = agents.filter((a) => !(AGENT_IDS as readonly string[]).includes(a));
  if (unknownAgents.length > 0) {
    console.error(`未注册的架构: ${unknownAgents.join(", ")}（可用: ${AGENT_IDS.join(", ")}）`);
    process.exitCode = 1;
    return;
  }
  // 厂商 key 提前校验：缺 key 的组合直接报错，不进入实验循环
  for (const provider of models) {
    const providerId = provider.includes(":") ? provider.slice(0, provider.indexOf(":")) : provider;
    try {
      createCompatibleModel(providerId);
    } catch (err) {
      console.error(String(err));
      process.exitCode = 1;
      return;
    }
  }

  console.log(`实验矩阵：${tasks.length} tasks × ${agents.length} agents × ${models.length} models × ${runs} runs = ${tasks.length * agents.length * models.length} experiments`);

  const experiments: ExperimentReport[] = [];
  const errors: string[] = [];
  for (const task of tasks) {
    for (const agent of agents) {
      for (const model of models) {
        try {
          const experiment = await runExperiment({ task, agent, model, runs, outDir });
          experiments.push(experiment);
        } catch (err) {
          // 单实验失败不中断矩阵：记录后继续（如网络错误、预算耗尽）
          const label = `${task} × ${agent} × ${model}`;
          errors.push(`${label}: ${String(err)}`);
          console.error(`[experiment] 失败 ${label}: ${String(err)}`);
        }
      }
    }
  }

  // ===== 汇总矩阵 + ArchitectureGain（相对同模型 raw 基线的成功率增益）=====
  const rows: string[][] = [
    ["task", "agent", "model", "runs", "successRate", "latencyMeanMs", "tokensMean", "archGain"]
  ];
  for (const e of experiments) {
    const st = e.summary.stability.details;
    rows.push([
      e.config.task,
      e.config.agent,
      e.config.model,
      String(e.config.runs),
      st.successRate.toFixed(2),
      String(st.latencyMeanMs),
      String(st.tokensMean),
      ""
    ]);
  }
  // ArchitectureGain(M,A,T) = Score(M,A,T) - Score(M,Raw,T)，按 task×model 分组找 raw 基线
  for (let i = 1; i < rows.length; i++) {
    const [task, agent, model] = rows[i];
    if (agent === "raw") {
      rows[i][7] = "baseline";
      continue;
    }
    const baselineRow = rows.find(
      (r) => r[0] === task && r[2] === model && r[1] === "raw"
    );
    const gain =
      baselineRow !== undefined
        ? Number(rows[i][4]) - Number(baselineRow[4])
        : Number.NaN;
    rows[i][7] = Number.isNaN(gain) ? "-" : (gain >= 0 ? "+" : "") + gain.toFixed(2);
  }
  printTable(rows);

  console.log(`\n实验根目录：${outDir}（config.json / summary.json / runs/run_00N.json）`);
  if (errors.length > 0) {
    console.error(`\n${errors.length} 个实验失败：`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
