// 效率评估器：从 Trace 派生步数/调用数/延迟/token 等观测指标
// 观测型评估器：不定义绝对分数（横向比较才有意义），只保证指标完整可派生
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type {
  EvaluationContext,
  EvaluationResult,
  Evaluator
} from "../../core/evaluator.js";

// 效率明细：全部从 Trace 事件流派生
export interface EfficiencyDetails {
  // 事件总数
  steps: number;
  // 模型调用次数
  modelCalls: number;
  // 工具调用次数
  toolCalls: number;
  // 工具失败次数（tool_result.ok === false）
  toolErrors: number;
  // 模型调用总延迟（毫秒，model_call → model_response 成对时间戳差之和）
  latencyMsTotal: number;
  // 模型调用平均延迟（毫秒）
  latencyMsMean: number;
  // 运行总时长（毫秒，末事件时间戳）
  durationMs: number;
  // 汇总 token
  inputTokens: number;
  outputTokens: number;
  // 执行效率 = TaskProgress / ToolCalls（每次工具调用换来的任务进度，无进度观测时 null）
  executionEfficiency: number | null;
}

// 从一条 observation JSON 中提取任务进度（统一 progress 协议，无则 -1）
function extractProgress(observation: string): number {
  try {
    const parsed = JSON.parse(observation) as {
      progress_completed?: unknown;
      completed_targets?: unknown;
    };
    for (const field of ["progress_completed", "completed_targets"] as const) {
      if (typeof parsed[field] === "number") {
        return parsed[field] as number;
      }
    }
  } catch {
    // 非 JSON 观测直接忽略
  }
  return -1;
}

// 架构效率观测：latency 由 model_call/model_response 成对事件派生（Agent 不经手）
export class EfficiencyEvaluator implements Evaluator<EfficiencyDetails> {
  name = "efficiency";

  async evaluate(context: EvaluationContext): Promise<EvaluationResult<EfficiencyDetails>> {
    const { trace } = context;

    let modelCalls = 0;
    let toolCalls = 0;
    let toolErrors = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let latencyTotal = 0;
    let latencyCount = 0;
    let durationMs = 0;
    // 任务进度：从 tool_result 观测提取的最大完成数（统一 progress 协议）
    let maxCompleted = -1;
    // 单槽配对：模型调用严格串行，model_call 之后首个 model_response 即其响应
    let pendingCallAt: number | null = null;

    for (const step of trace.steps) {
      durationMs = step.timestamp;
      switch (step.kind) {
        case "model_call":
          modelCalls += 1;
          pendingCallAt = step.timestamp;
          break;
        case "model_response":
          inputTokens += step.usage.promptTokens;
          outputTokens += step.usage.completionTokens;
          if (pendingCallAt !== null) {
            latencyTotal += step.timestamp - pendingCallAt;
            latencyCount += 1;
            pendingCallAt = null;
          }
          break;
        case "tool_call":
          toolCalls += 1;
          break;
        case "tool_result":
          if (!step.ok) toolErrors += 1;
          maxCompleted = Math.max(maxCompleted, extractProgress(step.observation));
          break;
        default:
          break;
      }
    }

    // ExecutionEfficiency = TaskProgress / ToolCalls：进度归一到 ground_truth 期望值
    const expected = Number(
      context.task.ground_truth?.targets ?? context.task.ground_truth?.ops ?? 0
    );
    const executionEfficiency =
      expected > 0 && toolCalls > 0 && maxCompleted >= 0
        ? Math.min(maxCompleted / expected, 1) / toolCalls
        : null;

    const hasFatalError = trace.steps.some((s) => s.kind === "error" && s.fatal === true);
    return {
      evaluator: this.name,
      score: 1,
      passed: !hasFatalError,
      details: {
        steps: trace.steps.length,
        modelCalls,
        toolCalls,
        toolErrors,
        latencyMsTotal: latencyTotal,
        latencyMsMean: latencyCount > 0 ? Math.round(latencyTotal / latencyCount) : 0,
        durationMs,
        inputTokens,
        outputTokens,
        executionEfficiency
      }
    };
  }
}
