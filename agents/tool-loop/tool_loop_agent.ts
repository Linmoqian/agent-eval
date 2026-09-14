// 工具循环 Agent：模型请求工具 → 执行 → observation 回传 → 循环，直至出文本/超步/出错
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import type { Agent, AgentConfig, AgentResult } from "../../core/agent.js";
import type { Message, Model, TokenUsage } from "../../core/model.js";
import type { Task } from "../../core/task.js";
import type { Tool } from "../../core/tool.js";
import { createTrace } from "../../core/trace.js";
import { addUsage, buildTaskPrompt, recordModelCall } from "../common.js";

// 默认迭代上限，与任务 constraints.max_steps 取较小值（每轮模型调用记一步）
const DEFAULT_MAX_STEPS = 20;

export class ToolLoopAgent implements Agent {
  name = "tool-loop";
  private model: Model | null = null;
  private toolPool: Tool[] = [];
  private fallbackMaxSteps = DEFAULT_MAX_STEPS;

  async init(config: AgentConfig): Promise<void> {
    this.model = config.model;
    this.toolPool = config.tools ?? [];
    if (config.maxSteps !== undefined) this.fallbackMaxSteps = config.maxSteps;
  }

  async run(task: Task): Promise<AgentResult> {
    if (this.model === null) throw new Error("ToolLoopAgent 未 init");
    const startedAt = Date.now();
    const trace = createTrace(task.task_id, this.name);
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // 按任务允许的工具列表取子集
    const allowed = new Set(task.tools);
    const tools = this.toolPool.filter((t) => allowed.has(t.name));
    const toolSpecs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));

    const maxSteps = Math.min(
      task.constraints?.max_steps ?? Number.MAX_SAFE_INTEGER,
      this.fallbackMaxSteps
    );

    const messages: Message[] = [
      {
        role: "system",
        content:
          "你是一个任务执行 Agent。使用提供的工具完成任务，所有目标完成后给出简短总结。"
      },
      { role: "user", content: buildTaskPrompt(task) }
    ];

    try {
      let round = 0;
      let finalAnswer: string | null = null;
      while (round < maxSteps) {
        round += 1;
        const resp = await this.model.generate(
          messages,
          toolSpecs.length > 0 ? { tools: toolSpecs } : undefined
        );
        recordModelCall(trace, resp);
        addUsage(usage, resp.usage);

        // 无工具调用：模型给出最终答案
        if (resp.toolCalls === undefined || resp.toolCalls.length === 0) {
          finalAnswer = resp.content;
          break;
        }

        // 记录 assistant 的工具调用消息（配对回传必需）
        messages.push({
          role: "assistant",
          content: resp.content,
          toolCalls: resp.toolCalls
        });

        for (const call of resp.toolCalls) {
          trace.record({ kind: "action", action: call });
          const impl = tools.find((t) => t.name === call.name);
          let output: unknown;
          if (impl === undefined) {
            output = { ok: false, reason: `unknown_tool: ${call.name}` };
          } else {
            try {
              output = await impl.execute(call.arguments);
            } catch (err) {
              output = { ok: false, reason: `tool_error: ${String(err)}` };
            }
          }
          const observation = JSON.stringify(output);
          trace.record({ kind: "observation", observation });
          messages.push({
            role: "tool",
            content: observation,
            toolCallId: call.id,
            name: call.name
          });
        }
      }

      const exhausted = finalAnswer === null && round >= maxSteps;
      if (exhausted) {
        trace.record({ kind: "error", thought: `步数耗尽: ${round}/${maxSteps}` });
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
      trace.record({ kind: "error", thought: String(err) });
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
    // ToolLoopAgent 每次 run 内部自建全部状态，无需清理
  }
}
