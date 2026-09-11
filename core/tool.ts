// 工具抽象：Agent 可调用的外部能力（函数调用）
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

// TODO: 工具接口待实现
export interface Tool {
  // 工具名称
  name: string;
  // 工具描述（供模型理解）
  description: string;
  // 执行工具
  execute(input: unknown): unknown;
}
