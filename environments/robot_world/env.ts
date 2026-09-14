// 机器人网格世界：planning 类任务的工具环境，observation 中携带 completed_targets 供评估器派生
// Created on 2026-09-13
// @author: https://github.com/Linmoqian

import world01 from "./world_01.json" with { type: "json" };
import world02 from "./world_02.json" with { type: "json" };
import world03 from "./world_03.json" with { type: "json" };
import world04 from "./world_04.json" with { type: "json" };

import type { Tool } from "../../core/tool.js";

// 地图数据结构（world_*.json）
interface WorldMap {
  grid: { width: number; height: number };
  start: { x: number; y: number };
  targets: { x: number; y: number }[];
  obstacles: { x: number; y: number }[];
}

// 机器人世界模拟器：一次 benchmark 运行持有一个实例，状态对 Agent 不可见
export class RobotWorldEnv {
  // 地图名，如 "world_01"
  readonly mapName: string;
  private readonly map: WorldMap;
  private position: { x: number; y: number };
  private readonly done: Set<string>;
  private readonly obstacles: Set<string>;

  constructor(mapName: string, map: WorldMap) {
    this.mapName = mapName;
    this.map = map;
    this.position = { ...map.start };
    this.done = new Set();
    this.obstacles = new Set(map.obstacles.map((o) => `${o.x},${o.y}`));
  }

  private static key(x: number, y: number): string {
    return `${x},${y}`;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.map.grid.width && y >= 0 && y < this.map.grid.height;
  }

  // 扫描：返回机器人位置、目标点完成状态与障碍列表
  scan(): Record<string, unknown> {
    return {
      position: this.position,
      targets: this.map.targets.map((t) => ({
        x: t.x,
        y: t.y,
        done: this.done.has(RobotWorldEnv.key(t.x, t.y))
      })),
      obstacles: [...this.obstacles].map((k) => {
        const [x, y] = k.split(",").map(Number);
        return { x, y };
      }),
      // 统一进度协议（M8）：供 success / executionEfficiency 派生
      progress_completed: this.done.size,
      progress_total: this.map.targets.length
    };
  }

  // 移动到绝对坐标：出界 / 障碍未清除时失败，到达目标点即完成该目标
  move(input: { x?: number; y?: number }): Record<string, unknown> {
    const x = Number(input.x);
    const y = Number(input.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inBounds(x, y)) {
      return { ok: false, reason: "out_of_bounds", grid: this.map.grid };
    }
    const key = RobotWorldEnv.key(x, y);
    if (this.obstacles.has(key)) {
      return { ok: false, reason: "obstacle", position: { x, y }, hint: "call clear first" };
    }
    this.position = { x, y };
    // 到达目标格即标记完成
    if (this.map.targets.some((t) => t.x === x && t.y === y)) {
      this.done.add(key);
    }
    return {
      ok: true,
      position: this.position,
      completed_targets: this.done.size,
      total_targets: this.map.targets.length,
      // 统一进度协议（M8）：completed_targets 为兼容旧字段保留
      progress_completed: this.done.size,
      progress_total: this.map.targets.length
    };
  }

  // 清除指定格子的障碍
  clear(input: { x?: number; y?: number }): Record<string, unknown> {
    const x = Number(input.x);
    const y = Number(input.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return { ok: false, reason: "invalid_coordinates" };
    }
    const removed = this.obstacles.delete(RobotWorldEnv.key(x, y));
    return {
      ok: true,
      cleared: removed,
      remaining_obstacles: this.obstacles.size
    };
  }
}

// 地图注册表：新地图在 json 落盘后于此登记，tsc 会将 import 的 json 一并 emit 到 dist
const MAPS: Record<string, WorldMap> = {
  world_01: world01 as WorldMap,
  world_02: world02 as WorldMap,
  world_03: world03 as WorldMap,
  world_04: world04 as WorldMap
};

// 按地图名加载世界并产出工具集，benchmark 按任务 tools 列表过滤后注入 Agent
export function createRobotWorldTools(mapName: string): Tool[] {
  // 任务里可能写 "world_01" 或 "world_01.json"，统一去后缀查表
  const key = mapName.replace(/\.json$/, "");
  const map = MAPS[key];
  if (map === undefined) {
    throw new Error(`未注册的地图: ${mapName}`);
  }

  const env = new RobotWorldEnv(key, map);
  return [
    {
      name: "scan",
      description: "扫描世界：返回机器人当前位置、所有目标点坐标及完成状态、障碍物列表",
      parameters: { type: "object", properties: {} },
      execute: async () => env.scan()
    },
    {
      name: "move",
      description: "移动机器人到绝对坐标 (x, y)；到达目标点即完成该目标，障碍格需先 clear",
      parameters: {
        type: "object",
        properties: {
          x: { type: "integer", description: "目标横坐标" },
          y: { type: "integer", description: "目标纵坐标" }
        },
        required: ["x", "y"]
      },
      execute: async (input) => env.move(input as { x?: number; y?: number })
    },
    {
      name: "clear",
      description: "清除指定坐标的障碍物，之后机器人才能移动到该格",
      parameters: {
        type: "object",
        properties: {
          x: { type: "integer", description: "障碍横坐标" },
          y: { type: "integer", description: "障碍纵坐标" }
        },
        required: ["x", "y"]
      },
      execute: async (input) => env.clear(input as { x?: number; y?: number })
    }
  ];
}
