// 键值存储环境：tool-use 类任务的工具环境，观测携带 progress_completed / state 快照供评估器派生
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import type { Tool } from "../../core/tool.js";

// KV 存储模拟器：一次 benchmark 运行持有一个实例，状态对 Agent 不可见
export class KVStoreEnv {
  private readonly store: Map<string, unknown>;
  private ops = 0;

  constructor(initial: Record<string, unknown>) {
    this.store = new Map(Object.entries(initial));
  }

  // 读键：观测携带值与累计操作数
  read(key: string): Record<string, unknown> {
    this.ops += 1;
    return {
      ok: true,
      exists: this.store.has(key),
      value: this.store.has(key) ? this.store.get(key) : null,
      progress_completed: this.ops
    };
  }

  // 写键：值必须是合法 JSON 值
  write(key: string, value: unknown): Record<string, unknown> {
    if (typeof key !== "string" || key.length === 0) {
      return { ok: false, reason: "invalid_key" };
    }
    if (value === undefined || typeof value === "function") {
      return { ok: false, reason: "invalid_value" };
    }
    this.ops += 1;
    this.store.set(key, value);
    return {
      ok: true,
      key,
      value,
      progress_completed: this.ops
    };
  }

  // 删键
  erase(key: string): Record<string, unknown> {
    this.ops += 1;
    const erased = this.store.delete(key);
    return {
      ok: true,
      erased,
      progress_completed: this.ops
    };
  }

  // 全量快照：观测含 state，供 success 的 state 模式比对
  list(): Record<string, unknown> {
    this.ops += 1;
    return {
      ok: true,
      state: Object.fromEntries(this.store),
      keys: [...this.store.keys()],
      progress_completed: this.ops
    };
  }
}

// 按任务初值创建 KV 工具集，benchmark 按任务 tools 列表过滤后注入 Agent
export function createKVTools(initial: Record<string, unknown>): Tool[] {
  const env = new KVStoreEnv(initial);
  return [
    {
      name: "read",
      description: "读取指定键的当前值",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "键名" }
        },
        required: ["key"]
      },
      execute: async (input) => env.read(String((input as { key?: unknown }).key))
    },
    {
      name: "write",
      description: "写入键值对，覆盖旧值",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "键名" },
          value: { description: "要写入的值（字符串或数字）" }
        },
        required: ["key", "value"]
      },
      execute: async (input) => {
        const { key, value } = input as { key?: unknown; value?: unknown };
        return env.write(String(key), value);
      }
    },
    {
      name: "erase",
      description: "删除指定键",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "键名" }
        },
        required: ["key"]
      },
      execute: async (input) => env.erase(String((input as { key?: unknown }).key))
    },
    {
      name: "list",
      description: "列出全部键值对（全量状态快照）",
      parameters: { type: "object", properties: {} },
      execute: async () => env.list()
    }
  ];
}
