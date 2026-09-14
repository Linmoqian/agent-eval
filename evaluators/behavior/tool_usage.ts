// 工具使用行为评估器：从 Trace 派生调用量 / 无效调用 / 重复调用，区分架构的用工具方式
// 观测型指标：不裁决任务成败，横向比较才有意义
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type {
  EvaluationContext,
  EvaluationResult,
  Evaluator
} from "../../core/evaluator.js";

// 工具使用明细：全部从 tool_call / tool_result 事件派生
export interface ToolUsageDetails {
  // 工具调用总次数
  toolCalls: number;
  // 去重后的唯一调用数（按 工具名+参数 指纹判定）
  uniqueToolCalls: number;
  // 无效调用数（配对 tool_result.ok === false：未知工具 / 参数非法 / 执行异常 / 业务失败）
  invalidToolCalls: number;
  // 重复调用数（与之前某次调用完全相同，不计首次）
  duplicateToolCalls: number;
  // 工具有效率 = 1 - invalidToolCalls / toolCalls（无调用时无定义）
  toolValidity: number | null;
  // 工具冗余率 = duplicateToolCalls / toolCalls（无调用时无定义）
  toolRedundancy: number | null;
}

// 调用指纹：工具名 + 排序后参数序列化，参数键序不影响判重
export function callFingerprint(name: string, args: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) {
    sorted[key] = args[key];
  }
  return `${name}:${JSON.stringify(sorted)}`;
}

// 行为视角的用工具统计：盲目循环多重复、规划架构少冗余
export class ToolUsageEvaluator implements Evaluator<ToolUsageDetails> {
  name = "tool-usage";

  async evaluate(
    context: EvaluationContext
  ): Promise<EvaluationResult<ToolUsageDetails>> {
    const { trace } = context;

    let toolCalls = 0;
    let invalidToolCalls = 0;
    let duplicateToolCalls = 0;
    const seen = new Set<string>();

    for (const step of trace.steps) {
      switch (step.kind) {
        case "tool_call": {
          toolCalls += 1;
          const fingerprint = callFingerprint(step.call.name, step.call.arguments);
          if (seen.has(fingerprint)) {
            duplicateToolCalls += 1;
          } else {
            seen.add(fingerprint);
          }
          break;
        }
        case "tool_result":
          // 每次失败观测对应一次无效调用（tool_call 与 tool_result 严格成对）
          if (!step.ok) invalidToolCalls += 1;
          break;
        default:
          break;
      }
    }

    const toolValidity =
      toolCalls > 0 ? 1 - invalidToolCalls / toolCalls : null;
    const toolRedundancy = toolCalls > 0 ? duplicateToolCalls / toolCalls : null;

    return {
      evaluator: this.name,
      // 有效率可作归一化分数；无调用时退化为满分（观测型语义）
      score: toolValidity ?? 1,
      passed: invalidToolCalls === 0,
      details: {
        toolCalls,
        uniqueToolCalls: seen.size,
        invalidToolCalls,
        duplicateToolCalls,
        toolValidity,
        toolRedundancy
      }
    };
  }
}
