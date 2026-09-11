// 执行轨迹：记录 Agent 每一步的动作、观测与 token 消耗
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

import type { TokenUsage } from "./model.js";
import type { ToolCall } from "./tool.js";

// 步骤类型：思考 / 工具调用 / 工具观测 / 报错
export type StepKind = "thought" | "action" | "observation" | "error";

// 单个轨迹步骤
export interface TraceStep {
  // 步骤序号，从 1 开始
  index: number;
  kind: StepKind;
  // 思考内容（thought 步）
  thought?: string;
  // 发起的工具调用（action 步）
  action?: ToolCall;
  // 工具返回的观测，序列化字符串（observation 步）
  observation?: string;
  // 该步 token 消耗（含模型调用的步）
  usage?: TokenUsage;
  // 记录时刻（任务开始的相对毫秒数）
  timestamp: number;
}

// 完整执行轨迹：所有架构统一产出，评估器的标准输入
export interface Trace {
  // 对应任务标识
  taskId: string;
  // 执行该任务的 Agent 名称
  agentName: string;
  // 执行步骤列表
  steps: TraceStep[];
}
