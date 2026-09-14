// 评估器抽象：Run 级评估器基于 Task/Result/Trace，Experiment 级评估器基于多次 Run 的聚合
// 二者彻底解耦：Agent 负责完成任务，Evaluator 只做观测函数
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { AgentResult } from "./agent.js";
import type { TokenUsage } from "./model.js";
import type { Task } from "./task.js";
import type { Trace } from "./trace.js";

// 评估上下文（Run 级）：单次执行的观测入口
export interface EvaluationContext {
  task: Task;
  result: AgentResult;
  trace: Trace;
  // 本次运行使用的模型名（如 "gpt-4o-mini"），供 cost 等需要模型元数据的评估器使用
  modelName?: string;
}

// 评估结果：T 为各评估器自定义的明细类型
export interface EvaluationResult<T = unknown> {
  // 评估器名称
  evaluator: string;
  // 归一化得分 0~1（观测型评估器不定义绝对分时恒为 1）
  score: number;
  // 是否通过
  passed: boolean;
  // 评估明细（各评估器自定义）
  details: T;
}

// Run 级评估器协议：E = f(Task, Result, Trace)，与 Agent 实现完全解耦
export interface Evaluator<T = unknown> {
  // 评估器名称，如 "success"
  name: string;
  // 对一次执行评分
  evaluate(context: EvaluationContext): Promise<EvaluationResult<T>>;
}

// 单次运行摘要：Experiment 层聚合的输入（不携带全量 trace，避免内存膨胀）
export interface RunSummary {
  runId: string;
  agentName: string;
  modelName: string;
  // Agent 自报成败（对照组，非裁决依据）
  success: boolean;
  // 失败原因
  error?: string;
  // 总耗时（毫秒）
  durationMs: number;
  // 汇总 token 用量
  usage: TokenUsage;
  // Run 级评估结果（success/efficiency/cost …）
  evaluations: EvaluationResult[];
}

// 评估上下文（Experiment 级）：同一 Task×Agent×Model 组合的多次运行
export interface ExperimentContext {
  // 轻量任务描述（完整 Task 在 run 层已有，聚合层不需要）
  task: { taskId: string; category: string };
  agentId: string;
  modelId: string;
  runs: RunSummary[];
}

// Experiment 级评估器协议：stability = f(run_1, ..., run_n)
export interface ExperimentEvaluator<T = unknown> {
  // 评估器名称，如 "stability"
  name: string;
  // 对一组重复运行评分
  evaluate(context: ExperimentContext): Promise<EvaluationResult<T>>;
}
