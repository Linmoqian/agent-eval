// Agent 抽象：接收任务，产出执行轨迹
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

// TODO: Agent 接口待实现
export interface Agent {
  // Agent 名称
  name: string;
  // 执行任务，返回轨迹
  run(task: unknown): unknown;
}
