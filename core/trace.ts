// 执行轨迹：Agent 只产生事件、框架统一收集，轨迹是评估框架的实验观测层
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type { TokenUsage } from "./model.js";
import type { ToolCall } from "./tool.js";

// 步骤类型：模型调用 / 思考 / 工具调用 / 工具观测 / 报错
export type StepKind = "model_call" | "thought" | "action" | "observation" | "error";

// 单个轨迹步骤
export interface TraceStep {
  // 步骤序号，从 1 开始
  index: number;
  kind: StepKind;
  // 文本内容：model_call 步放响应摘要，thought 步放思考，error 步放错误信息
  thought?: string;
  // 发起的工具调用（action 步）
  action?: ToolCall;
  // 工具返回的观测，序列化字符串（observation 步）
  observation?: string;
  // 该步 token 消耗（model_call 步必填）
  usage?: TokenUsage;
  // 记录时刻（任务开始的相对毫秒数）
  timestamp: number;
}

// Agent 记录事件时传入的字段，index / timestamp 由框架自动补齐
export type TraceEvent = Omit<TraceStep, "index" | "timestamp">;

// 完整执行轨迹：既是最终数据，也是统一的事件收集器
export interface Trace {
  // 对应任务标识
  taskId: string;
  // 执行该任务的 Agent 名称
  agentName: string;
  // 执行步骤列表
  steps: TraceStep[];
  // Agent 唯一入口：产生一个事件，框架负责编号与计时
  record(event: TraceEvent): void;
}

// 创建轨迹收集器，Agent 与评估器共用
export function createTrace(taskId: string, agentName: string): Trace {
  const startedAt = Date.now();
  const steps: TraceStep[] = [];
  return {
    taskId,
    agentName,
    steps,
    record(event) {
      steps.push({
        ...event,
        index: steps.length + 1,
        timestamp: Date.now() - startedAt
      });
    }
  };
}
