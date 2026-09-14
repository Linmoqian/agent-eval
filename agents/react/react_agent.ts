// ReAct Agent：每轮 Thought（推理）→ Action（单工具调用）→ Observation 显式交替
// 结构特点：显式推理步骤 + 每轮严格单动作，与 tool-loop 的并行多调用形成对照
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { Agent, AgentConfig, AgentResult } from "../../core/agent.js";
import type { Message, Model, TokenUsage } from "../../core/model.js";
import type { Task } from "../../core/task.js";
import type { Tool } from "../../core/tool.js";
import { createTrace } from "../../core/trace.js";
import {
  addUsage,
  buildTaskPrompt,
  recordModelRequest,
  recordModelResponse,
  requireModel,
  runToolCall,
  selectTools
} from "../common.js";

const DEFAULT_MAX_STEPS = 30;

// ReAct 系统提示：引导模型先推理再行动，每轮恰好一个动作
const REACT_SYSTEM = [
  "你是一个 ReAct Agent，按 Thought → Action → Observation 循环工作。",
  "每轮先输出 Thought：对当前局势的简短推理（还剩什么目标、下一步为什么这样做）。",
  "然后发起恰好一个 Action（工具调用）。",
  "所有目标完成后不再调用工具，直接输出最终总结。"
].join("\n");

export class ReactAgent implements Agent {
  name = "react";
  private model: Model | null = null;
  private toolPool: Tool[] = [];
  private fallbackMaxSteps = DEFAULT_MAX_STEPS;

  async init(config: AgentConfig): Promise<void> {
    this.model = config.model;
    this.toolPool = config.tools ?? [];
    if (config.maxSteps !== undefined) this.fallbackMaxSteps = config.maxSteps;
  }

  async run(task: Task): Promise<AgentResult> {
    const model = requireModel(this.model, this.name);
    const startedAt = Date.now();
    const trace = createTrace(task.task_id, this.name);
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const { tools, toolNames, specs } = selectTools(this.toolPool, task.tools);
    const generateOptions = specs.length > 0 ? { tools: specs } : undefined;

    const maxSteps = Math.min(
      task.constraints?.max_steps ?? Number.MAX_SAFE_INTEGER,
      this.fallbackMaxSteps
    );

    const messages: Message[] = [
      { role: "system", content: REACT_SYSTEM },
      { role: "user", content: buildTaskPrompt(task) }
    ];

    try {
      let round = 0;
      let finalAnswer: string | null = null;
      while (round < maxSteps) {
        round += 1;
        recordModelRequest(trace, {
          round,
          purpose: "act",
          messageCount: messages.length,
          tools: toolNames
        });
        const resp = await model.generate(messages, generateOptions);
        recordModelResponse(trace, resp);
        addUsage(usage, resp.usage);
        messages.push({
          role: "assistant",
          content: resp.content,
          toolCalls: resp.toolCalls
        });

        // 显式 Reason 步骤：模型文本即 Thought，进入轨迹供行为指标派生
        if (resp.content !== null && resp.content.length > 0) {
          trace.record({ kind: "thought", text: resp.content, source: "model" });
        }

        const calls = resp.toolCalls ?? [];
        // 无动作：模型给出最终答案
        if (calls.length === 0) {
          finalAnswer = resp.content;
          break;
        }

        // 单动作约束：只执行本轮第一个调用，多余的记入轨迹但不执行
        if (calls.length > 1) {
          trace.record({
            kind: "thought",
            text: `单动作约束：忽略本轮多余 ${calls.length - 1} 个工具调用`,
            source: "agent"
          });
        }
        const call = calls[0];
        const { observation } = await runToolCall(trace, tools, call);
        messages.push({
          role: "tool",
          content: observation,
          toolCallId: call.id,
          name: call.name
        });
      }

      const exhausted = finalAnswer === null && round >= maxSteps;
      if (exhausted) {
        trace.record({ kind: "error", message: `步数耗尽: ${round}/${maxSteps}`, fatal: true });
      }

      return {
        taskId: task.task_id,
        agentName: this.name,
        success: !exhausted,
        finalAnswer,
        trace,
        usage,
        durationMs: Date.now() - startedAt,
        error: exhausted ? `步数耗尽: ${round}/${maxSteps}` : undefined
      };
    } catch (err) {
      trace.record({ kind: "error", message: String(err), fatal: true });
      return {
        taskId: task.task_id,
        agentName: this.name,
        success: false,
        finalAnswer: null,
        trace,
        usage,
        durationMs: Date.now() - startedAt,
        error: String(err)
      };
    }
  }

  async reset(): Promise<void> {
    // ReactAgent 每次 run 内部自建全部状态，无需清理
  }
}
