// 执行轨迹：Agent 只产生事件、框架统一收集，轨迹是评估框架的实验观测层
// 事件采用判别联合：架构比较时数据结构不碎掉，全部指标均可从事件流派生
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { TokenUsage } from "./model.js";
import type { ToolCall } from "./tool.js";

// 计划步骤：plan_created / plan_updated 事件的载荷，与架构无关
export interface PlanStep {
  // 步骤序号，从 1 开始
  index: number;
  // 步骤的自然语言描述
  description: string;
  // 当前状态
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
}

// 发起一次模型调用（请求侧）：与 model_response 成对出现，两个事件的 timestamp 差即单次调用延迟
export interface ModelCallEvent {
  kind: "model_call";
  // 第几轮模型调用，从 1 开始（跨阶段全局递增）
  round: number;
  // 调用目的（架构自述）：plan / act / replan / final 等
  purpose?: string;
  // 请求携带的消息条数与暴露的工具名，供上下文占用类指标派生
  messageCount?: number;
  tools?: string[];
}

// 收到一次模型响应（响应侧）：usage 是成本/效率指标的唯一来源
export interface ModelResponseEvent {
  kind: "model_response";
  finishReason: "stop" | "tool_calls" | "length" | "error";
  // 文本输出
  content?: string | null;
  // 模型发起的工具调用请求
  toolCalls?: ToolCall[];
  // 本次 token 用量
  usage: TokenUsage;
}

// 思考事件：ReAct 的 Reason 步骤，或架构内部的推理说明
export interface ThoughtEvent {
  kind: "thought";
  text: string;
  // 推理来源：模型生成 / 架构内部逻辑
  source: "model" | "agent";
}

// 工具调用事件：Agent 发起一次工具执行
export interface ToolCallEvent {
  kind: "tool_call";
  call: ToolCall;
}

// 工具结果事件：环境返回的观测
export interface ToolResultEvent {
  kind: "tool_result";
  // 对应 ToolCallEvent 里调用的唯一标识
  callId: string;
  // 工具名（冗余存储，便于按名统计）
  name: string;
  // 序列化后的观测内容
  observation: string;
  // 环境侧是否成功（观测含 ok:false 或执行异常均为 false）
  ok: boolean;
  // 工具执行耗时（毫秒）
  durationMs?: number;
}

// 计划创建事件：plan-execute / planner-executor 产出初始计划
export interface PlanCreatedEvent {
  kind: "plan_created";
  steps: PlanStep[];
}

// 计划更新事件：单步状态流转或整体修订
export interface PlanUpdatedEvent {
  kind: "plan_updated";
  change: "step_started" | "step_completed" | "step_failed" | "revised";
  // 变更涉及的步骤序号（revised 可省略）
  stepIndex?: number;
  // revised 时携带修订后的完整计划快照
  steps?: PlanStep[];
  note?: string;
}

// 架构状态事件：phase 变迁（planning / executing / replanning / finalizing …）
export interface AgentStateEvent {
  kind: "agent_state";
  phase: string;
  note?: string;
}

// 错误事件
export interface ErrorEvent {
  kind: "error";
  message: string;
  // 是否致命（终止本次 run）
  fatal?: boolean;
}

// Agent 记录事件时传入的载荷：index / timestamp 由框架自动补齐
export type TraceEvent =
  | ModelCallEvent
  | ModelResponseEvent
  | ThoughtEvent
  | ToolCallEvent
  | ToolResultEvent
  | PlanCreatedEvent
  | PlanUpdatedEvent
  | AgentStateEvent
  | ErrorEvent;

// 落盘后的完整步骤：事件 + 框架编号 + 任务内相对时间戳
export type TraceStep = TraceEvent & {
  index: number;
  timestamp: number;
};

// 完整执行轨迹：既是最终数据，也是统一的事件收集器
export interface Trace {
  // 对应任务标识
  taskId: string;
  // 执行该任务的 Agent 名称
  agentName: string;
  // 事件步骤列表
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
