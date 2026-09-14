// M7 鲁棒性链路验证：FaultInjector 故障注入 + RobustnessEvaluator 恢复率派生（离线，零网络）
// 验收：注入确定性可复现、恢复率从 Trace 派生、benchmark 集成链路完整
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import { createTrace, type TraceEvent } from "../core/trace.js";
import type { AgentResult } from "../core/agent.js";
import type { EvaluationContext } from "../core/evaluator.js";

import { benchmark, loadTask, type BenchmarkReport } from "./benchmark.js";
import { ScriptedModel } from "../models/local/scripted_model.js";
import { buildPlannerScripts, buildToolLoopScript } from "./scripts.js";
import { createRobotWorldTools } from "../environments/robot_world/env.js";
import { wrapToolsWithFaults } from "../environments/fault_injector.js";
import { FAULT_PROFILES } from "../core/fault.js";
import { RobustnessEvaluator, type RobustnessDetails } from "../evaluators/robustness/robustness_evaluator.js";

// 断言收集器
const failures: string[] = [];
function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

// ===== 1. FaultInjector 单元验证 =====
async function verifyInjector(): Promise<void> {
  console.log("\n===== 1. FaultInjector 注入行为 =====");

  const clean = createRobotWorldTools("world_01");
  const scan = clean.find((t) => t.name === "scan");
  const normal = await scan?.execute({});
  expect(
    typeof normal === "object" && normal !== null && (normal as { fault?: unknown }).fault === undefined,
    "clean 工具观测不应携带 fault 标记"
  );
  console.log(`clean scan        : ok=${JSON.stringify(normal).slice(0, 60)}…`);

  // rate=1 全失败
  const allFail = wrapToolsWithFaults(clean, { toolFailureRate: 1 }, 42);
  const failed = (await allFail[0].execute({})) as { ok?: boolean; fault?: { type?: string } };
  expect(
    failed.ok === false && failed.fault?.type === "tool_failure",
    `rate=1 应全部注入 tool_failure，实际 ${JSON.stringify(failed)}`
  );
  console.log(`rate=1 toolFailure: ok=${failed.ok} fault=${failed.fault?.type}`);

  // timeout 注入（真实等待，duration 可观测）
  const allTimeout = wrapToolsWithFaults(clean, { toolTimeoutRate: 1 }, 42);
  const startedAt = Date.now();
  const timedOut = (await allTimeout[0].execute({})) as {
    ok?: boolean;
    reason?: string;
    fault?: { type?: string };
  };
  const elapsed = Date.now() - startedAt;
  expect(
    timedOut.ok === false && timedOut.fault?.type === "tool_timeout",
    `timeout 注入应返回 tool_timeout 失败，实际 ${JSON.stringify(timedOut)}`
  );
  expect(elapsed >= 40, `模拟超时应真实等待，实际 ${elapsed}ms`);
  console.log(`rate=1 timeout   : ok=${timedOut.ok} fault=${timedOut.fault?.type} waited=${elapsed}ms`);

  // 观测丢弃：调用成功但无信息量
  const allDrop = wrapToolsWithFaults(clean, { observationDropRate: 1 }, 42);
  const dropped = (await allDrop[0].execute({})) as Record<string, unknown>;
  expect(
    dropped.fault !== undefined && dropped.position === undefined,
    `观测丢弃应只剩 fault 标记，实际 ${JSON.stringify(dropped)}`
  );
  console.log(`rate=1 drop      : ${JSON.stringify(dropped)}`);

  // 观测噪声：原字段保留 + noise 追加
  const allNoise = wrapToolsWithFaults(clean, { observationNoiseRate: 1 }, 42);
  const noised = (await allNoise[0].execute({})) as Record<string, unknown>;
  expect(
    noised.position !== undefined && typeof noised.noise === "string" && noised.fault !== undefined,
    `噪声应保留原字段并追加 noise，实际 ${JSON.stringify(noised).slice(0, 80)}`
  );
  console.log(`rate=1 noise     : position 保留 + noise=${noised.noise}`);

  // 确定性复现：同 seed 两套包装，同序列调用 → 同故障序列
  const runSequence = async (): Promise<string[]> => {
    const tools = wrapToolsWithFaults(createRobotWorldTools("world_01"), FAULT_PROFILES.medium, 7);
    const marks: string[] = [];
    for (let i = 0; i < 24; i++) {
      const out = (await tools[i % 3].execute(i % 3 === 1 ? { x: 1, y: 1 } : {})) as {
        fault?: { type?: string };
      };
      marks.push(out.fault?.type ?? "-");
    }
    return marks;
  };
  const seqA = await runSequence();
  const seqB = await runSequence();
  expect(
    JSON.stringify(seqA) === JSON.stringify(seqB),
    "同 seed 同调用序列应产生完全相同的故障序列"
  );
  const injectedCount = seqA.filter((m) => m !== "-").length;
  expect(injectedCount > 0, `medium seed=7 的 24 次调用应命中至少 1 次故障`);
  console.log(`复现性           : 24 次调用同 seed 两次序列一致，注入 ${injectedCount} 次：${seqA.filter((m) => m !== "-").join(",")}`);
}

// ===== 2. RobustnessEvaluator 恢复判定（手工 trace）=====
async function verifyEvaluator(): Promise<void> {
  console.log("\n===== 2. RobustnessEvaluator 恢复率派生 =====");
  const evaluator = new RobustnessEvaluator();
  const task = loadTask("robot_path_001");

  const buildContext = (events: TraceEvent[]): EvaluationContext => {
    const trace = createTrace("verify", "test");
    for (const e of events) trace.record(e);
    return {
      task,
      result: {
        taskId: "verify",
        agentName: "test",
        success: true,
        finalAnswer: null,
        trace,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        durationMs: 0
      } satisfies AgentResult,
      trace
    };
  };

  const call = (id: string, x: number, y: number) => ({
    kind: "tool_call" as const,
    call: { id, name: "move", arguments: { x, y } }
  });
  const result = (callId: string, ok: boolean, fault: boolean) => ({
    kind: "tool_result" as const,
    callId,
    name: "move",
    observation: JSON.stringify(
      fault ? { ok: false, fault: { type: "tool_failure", injected: true } } : { ok: true }
    ),
    ok
  });

  // 场景 A：故障失败后同指纹重试成功 → recoveryRate=1
  const ctxA = buildContext([
    call("c1", 2, 1),
    result("c1", false, true),
    call("c2", 2, 1),
    result("c2", true, false)
  ]);
  const detA = (await evaluator.evaluate(ctxA)).details as RobustnessDetails;
  expect(detA.injectedFaults === 1 && detA.failedByFault === 1, `场景A 注入计数错误: ${JSON.stringify(detA)}`);
  expect(detA.recoveredFaults === 1 && detA.recoveryRate === 1, `场景A 同指纹重试应计恢复: ${JSON.stringify(detA)}`);
  console.log(`A 重试恢复        : ${JSON.stringify(detA)}`);

  // 场景 B：故障失败后换参数（换策略）成功 → 恢复不计入
  const ctxB = buildContext([
    call("c1", 2, 1),
    result("c1", false, true),
    call("c2", 3, 4),
    result("c2", true, false)
  ]);
  const detB = (await evaluator.evaluate(ctxB)).details as RobustnessDetails;
  expect(
    detB.recoveredFaults === 0 && detB.recoveryRate === 0,
    `场景B 换策略不计恢复（保守口径）: ${JSON.stringify(detB)}`
  );
  console.log(`B 换策略          : recoveryRate=${detB.recoveryRate}（换策略交由 success 观察）`);

  // 场景 C：无故障 → recoveryRate 无定义
  const ctxC = buildContext([call("c1", 2, 1), result("c1", true, false)]);
  const detC = (await evaluator.evaluate(ctxC)).details as RobustnessDetails;
  expect(detC.injectedFaults === 0 && detC.recoveryRate === null, `场景C 无注入应为 null: ${JSON.stringify(detC)}`);
  console.log(`C 无故障          : recoveryRate=${detC.recoveryRate}`);
}

// ===== 3. 集成：planner-executor × 故障条件跑通完整链路 =====
async function verifyIntegration(): Promise<void> {
  console.log("\n===== 3. benchmark 集成（planner-executor × 故障条件）=====");

  const runOnce = async (fault: string | undefined): Promise<BenchmarkReport> => {
    const { planner, executor } = buildPlannerScripts();
    return await benchmark(
      {
        task: "robot_path_001",
        agent: "planner-executor",
        model: new ScriptedModel(executor, "scripted-executor"),
        agentOptions: { plannerModel: new ScriptedModel(planner, "scripted-planner") },
        fault,
        outDir: null
      }
    );
  };

  const detailsOf = (r: BenchmarkReport): RobustnessDetails => {
    const found = r.evaluations.find((e) => e.evaluator === "robustness");
    if (found === undefined) throw new Error("缺少 robustness 评估器");
    return found.details as RobustnessDetails;
  };

  // clean 基线：无注入
  const cleanReport = await runOnce(undefined);
  const cleanDet = detailsOf(cleanReport);
  expect(cleanDet.injectedFaults === 0, `clean 不应注入，实际 ${cleanDet.injectedFaults}`);
  console.log(`clean             : injected=${cleanDet.injectedFaults} success=${cleanReport.result.success}`);

  // medium 固定种子：两次运行注入次数一致（复现性）
  const m1 = await runOnce("medium:7");
  const m2 = await runOnce("medium:7");
  const d1 = detailsOf(m1);
  const d2 = detailsOf(m2);
  expect(
    d1.injectedFaults === d2.injectedFaults,
    `同 seed 两次实验注入数应一致，实际 ${d1.injectedFaults} vs ${d2.injectedFaults}`
  );
  console.log(`medium:7 复现     : 两次 injected=${d1.injectedFaults} 一致，faultTypes=${JSON.stringify(d1.faultTypes)}`);
  console.log(`                  : failedByFault=${d1.failedByFault} recovered=${d1.recoveredFaults} recoveryRate=${d1.recoveryRate}`);
  console.log(`                  : success=${m1.result.success}（剧本回放不感知故障，真实恢复行为待 M9 真模型验证）`);

  // heavy 固定种子：注入显著增多
  const h1 = await runOnce("heavy:7");
  const dh = detailsOf(h1);
  expect(dh.injectedFaults >= d1.injectedFaults, `heavy 注入应不少于 medium，实际 ${dh.injectedFaults} vs ${d1.injectedFaults}`);
  console.log(`heavy:7           : injected=${dh.injectedFaults} faultTypes=${JSON.stringify(dh.faultTypes)} success=${h1.result.success}`);

  // 多类型注入验证：tool-loop 不因失败观测终止，剧本 12 次调用全部执行，heavy 应命中多类故障
  const loopHeavy = await benchmark(
    {
      task: "robot_path_001",
      agent: "tool-loop",
      model: new ScriptedModel(buildToolLoopScript(), "scripted-loop"),
      fault: "heavy:7",
      outDir: null
    }
  );
  const loopDet = detailsOf(loopHeavy);
  const loopTypeCount = Object.keys(loopDet.faultTypes).length;
  expect(
    loopDet.injectedFaults > d1.injectedFaults,
    `tool-loop×heavy 注入应显著多于 medium，实际 ${loopDet.injectedFaults} vs ${d1.injectedFaults}`
  );
  expect(loopTypeCount >= 2, `heavy 应命中至少 2 类故障，实际 ${JSON.stringify(loopDet.faultTypes)}`);
  console.log(`tool-loop×heavy:7: injected=${loopDet.injectedFaults}（${loopTypeCount} 类）faultTypes=${JSON.stringify(loopDet.faultTypes)}`);
  console.log(`                  : failedByFault=${loopDet.failedByFault} recovered=${loopDet.recoveredFaults}（剧本含重复调用，故障后同指纹重试成功即恢复）`);
}

async function main(): Promise<void> {
  console.log("M7 鲁棒性链路验证（FaultInjector + RobustnessEvaluator，离线）");
  await verifyInjector();
  await verifyEvaluator();
  await verifyIntegration();

  console.log("\n===== 结论 =====");
  if (failures.length === 0) {
    console.log("✅ M7 验证通过：故障为实验条件（环境侧注入）、恢复率为观测指标（Trace 派生）、同种子可复现。");
  } else {
    console.error("❌ M7 验证未达预期：");
    for (const f of failures) console.error(`   - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
