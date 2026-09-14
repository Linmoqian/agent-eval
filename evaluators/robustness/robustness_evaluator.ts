// 鲁棒性评估器：从 Trace 派生注入故障数与恢复率，只观察不注入
// RecoveryRate = RecoveredFaults / InjectedFaults：故障后同指纹调用重试成功即恢复
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type {
  EvaluationContext,
  EvaluationResult,
  Evaluator
} from "../../core/evaluator.js";
import { callFingerprint } from "../behavior/tool_usage.js";

// 鲁棒性明细：全部从 tool_call / tool_result 事件派生
export interface RobustnessDetails {
  // 注入故障总数（含噪声 / 丢弃等非失败类）
  injectedFaults: number;
  // 按故障类型计数（tool_failure / tool_timeout / observation_drop / observation_noise）
  faultTypes: Record<string, number>;
  // 注入导致调用失败的次数（failure / timeout）
  failedByFault: number;
  // 恢复次数：故障失败后，同一指纹（工具名+参数）调用再次出现且成功
  recoveredFaults: number;
  // 恢复率 = recoveredFaults / failedByFault（无故障注入时无定义）
  recoveryRate: number | null;
}

// 从观测 JSON 提取注入标记
function parseFaultType(observation: string): string | null {
  try {
    const parsed = JSON.parse(observation) as { fault?: unknown };
    if (typeof parsed.fault === "object" && parsed.fault !== null) {
      const type = (parsed.fault as { type?: unknown }).type;
      if (typeof type === "string") return type;
    }
  } catch {
    // 非 JSON 观测直接忽略
  }
  return null;
}

// 故障后的恢复行为观测：重试成功 / 换策略 / 放弃，架构差异的恢复面
export class RobustnessEvaluator implements Evaluator<RobustnessDetails> {
  name = "robustness";

  async evaluate(
    context: EvaluationContext
  ): Promise<EvaluationResult<RobustnessDetails>> {
    const { trace } = context;

    // pass 1：callId → 指纹；记录每次 result 的故障类型与成败
    const fingerprints = new Map<string, string>();
    const results: { fingerprint: string; ok: boolean; faultType: string | null; index: number }[] = [];
    for (const step of trace.steps) {
      if (step.kind === "tool_call") {
        fingerprints.set(
          step.call.id,
          callFingerprint(step.call.name, step.call.arguments)
        );
      } else if (step.kind === "tool_result") {
        results.push({
          fingerprint: fingerprints.get(step.callId) ?? `unknown:${step.callId}`,
          ok: step.ok,
          faultType: parseFaultType(step.observation),
          index: step.index
        });
      }
    }

    // pass 2：按指纹归组成功调用位置，判定每个故障失败是否被同指纹重试恢复
    const successIndexesByFp = new Map<string, number[]>();
    for (const r of results) {
      if (!r.ok) continue;
      const list = successIndexesByFp.get(r.fingerprint);
      if (list === undefined) {
        successIndexesByFp.set(r.fingerprint, [r.index]);
      } else {
        list.push(r.index);
      }
    }

    let injectedFaults = 0;
    let failedByFault = 0;
    let recoveredFaults = 0;
    const faultTypes: Record<string, number> = {};
    for (const r of results) {
      if (r.faultType === null) continue;
      injectedFaults += 1;
      faultTypes[r.faultType] = (faultTypes[r.faultType] ?? 0) + 1;
      // 只有注入导致失败的调用才谈恢复（噪声/丢弃类调用本身成功）
      if (!r.ok) {
        failedByFault += 1;
        const successes = successIndexesByFp.get(r.fingerprint);
        if (
          successes !== undefined &&
          successes.some((idx) => idx > r.index)
        ) {
          recoveredFaults += 1;
        }
      }
    }

    return {
      evaluator: this.name,
      // 恢复率可作归一化分数；无注入时退化为满分（观测型语义）
      score: failedByFault > 0 ? recoveredFaults / failedByFault : 1,
      // 纯观测：注入是实验条件，不作为通过与否的裁决
      passed: true,
      details: {
        injectedFaults,
        faultTypes,
        failedByFault,
        recoveredFaults,
        recoveryRate: failedByFault > 0 ? recoveredFaults / failedByFault : null
      }
    };
  }
}
