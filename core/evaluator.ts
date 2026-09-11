// 评估器抽象：对执行轨迹打分，产出指标
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

// TODO: 评估器接口待实现
export interface Evaluator {
  // 评估器名称
  name: string;
  // 对轨迹评分
  evaluate(trace: unknown): unknown;
}
