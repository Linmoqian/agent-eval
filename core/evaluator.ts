// 评估器抽象：所有评估器都只是观测函数 E = f(Task, Result, Trace)，不进入 Agent 内部
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type { AgentResult } from "./agent.js";
import type { Task } from "./task.js";
import type { Trace } from "./trace.js";

// 评估上下文：Agent 负责完成任务，Evaluator 负责评价任务，二者只通过此结构解耦
export interface EvaluationContext {
  task: Task;
  result: AgentResult;
  trace: Trace;
}

// 评估结果：T 为各评估器自定义的明细类型
export interface EvaluationResult<T = unknown> {
  // 评估器名称
  evaluator: string;
  // 归一化得分 0~1
  score: number;
  // 是否通过
  passed: boolean;
  // 评估明细（各评估器自定义）
  details: T;
}

// 评估器协议：基于 Task / Result / Trace 计算，与 Agent 实现完全解耦
export interface Evaluator<T = unknown> {
  // 评估器名称，如 "success"
  name: string;
  // 对一次执行评分
  evaluate(context: EvaluationContext): Promise<EvaluationResult<T>>;
}
