// 执行轨迹：记录 Agent 每一步的动作、观测与 token 消耗
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

// TODO: 轨迹接口待实现
export interface Trace {
  // 对应任务标识
  taskId: string;
  // 执行步骤列表
  steps: unknown[];
}
