// Agent 抽象：所有架构实现同一协议，输入输出完全一致，仅内部工作方式不同
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

import type { Model, TokenUsage } from "./model.js";
import type { Task } from "./task.js";
import type { Tool } from "./tool.js";
import type { Trace } from "./trace.js";

// Agent 初始化配置
export interface AgentConfig {
  // 注入的模型适配器，Agent 不感知具体厂商
  model: Model;
  // 环境侧可用的工具实现池，按任务 tools 列表取子集
  tools?: Tool[];
  // 最大迭代步数上限，可与任务 constraints.max_steps 共同生效
  maxSteps?: number;
  // 各架构自定义参数（如计划模板、反思开关、子 Agent 数）
  options?: Record<string, unknown>;
}

// Agent 统一产出：与架构无关，评估器只看这一份结果
export interface AgentResult {
  // 对应任务标识
  taskId: string;
  // 执行该任务的 Agent 名称
  agentName: string;
  // 是否在约束内完成任务
  success: boolean;
  // 最终答案或结论
  finalAnswer: string | null;
  // 完整执行轨迹
  trace: Trace;
  // 整个任务汇总的 token 用量
  usage: TokenUsage;
  // 总耗时（毫秒）
  durationMs: number;
  // 失败原因
  error?: string;
}

// Agent 协议：react / tool-loop / plan-execute / planner-executor / multi-agent 均实现此接口
export interface Agent {
  // 架构名称，如 "react"
  name: string;
  // 注入模型与工具池，完成初始化
  init(config: AgentConfig): Promise<void>;
  // 执行任务，返回统一结果
  run(task: Task): Promise<AgentResult>;
  // 清空内部状态，供下一任务复用实例
  reset(): Promise<void>;
}
