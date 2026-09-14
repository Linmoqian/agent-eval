// 故障注入器：在环境侧包装工具实施故障，Agent 与任务环境均不感知
// 注入的故障在观测 JSON 中携带 fault 字段标记，Trace 仍是评估的唯一事实来源
// 种子化随机（mulberry32）：同一种子同一调用序列 → 同一故障序列，实验可复现
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { FaultConfig } from "../core/fault.js";
import type { Tool } from "../core/tool.js";

// 模拟超时时长（毫秒）：让 tool_result.durationMs 可观测到超时特征
const SIMULATED_TIMEOUT_MS = 50;

// mulberry32：小型可种子化 PRNG，足够故障注入使用且跨平台确定
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 观测噪声样本：一个无信息量的扰动字段
function noiseSample(rand: () => number): string {
  return `±${rand().toFixed(4)}`;
}

// 判定是否命中（rate 未配置不消费随机数，保证序列确定性）
function hit(rate: number | undefined, rand: () => number): boolean {
  if (rate === undefined || rate <= 0) return false;
  return rand() < rate;
}

// 单次带故障的执行：四类故障按固定顺序判定，命中即短路返回
async function executeWithFaults(
  tool: Tool,
  input: Record<string, unknown>,
  config: FaultConfig,
  rand: () => number
): Promise<unknown> {
  // 1. 工具直接失败：Agent 收到明确错误，观测其是否重试/换策略
  if (hit(config.toolFailureRate, rand)) {
    return {
      ok: false,
      reason: "fault_injected:tool_failure",
      fault: { type: "tool_failure", injected: true }
    };
  }
  // 2. 模拟超时：真实等待后返回超时观测，durationMs 可派生
  if (hit(config.toolTimeoutRate, rand)) {
    await new Promise((resolve) => setTimeout(resolve, SIMULATED_TIMEOUT_MS));
    return {
      ok: false,
      reason: "fault_injected:tool_timeout",
      fault: { type: "tool_timeout", injected: true, timeoutMs: SIMULATED_TIMEOUT_MS }
    };
  }
  // 3. 真实执行工具
  const output = await tool.execute(input);
  if (typeof output !== "object" || output === null) {
    return output;
  }
  // 4. 观测丢弃：调用成功但无信息量
  if (hit(config.observationDropRate, rand)) {
    return { fault: { type: "observation_drop", injected: true } };
  }
  // 5. 观测噪声：原字段保留（不破坏 completed_targets 等派生），追加噪声
  if (hit(config.observationNoiseRate, rand)) {
    return {
      ...(output as Record<string, unknown>),
      noise: noiseSample(rand),
      fault: { type: "observation_noise", injected: true }
    };
  }
  return output;
}

// 包装工具池：返回带故障注入的 Tool 数组，接口不变
// 随机流按调用顺序共享（与工具实例无关），调用序列一致则故障序列一致
export function wrapToolsWithFaults(
  tools: Tool[],
  config: FaultConfig,
  seed: number
): Tool[] {
  const rand = mulberry32(seed);
  return tools.map((tool) => ({
    ...tool,
    execute: (input: Record<string, unknown>) =>
      executeWithFaults(tool, input, config, rand)
  }));
}
