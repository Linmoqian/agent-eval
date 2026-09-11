// 模型抽象：统一各厂商 LLM 的调用接口
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

// TODO: 模型接口待实现
export interface Model {
  // 模型名称
  name: string;
  // 发送对话请求
  complete(messages: unknown): unknown;
}
