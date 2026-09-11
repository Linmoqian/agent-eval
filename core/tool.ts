// 工具抽象：Agent 可调用的外部能力（函数调用）
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

// 工具声明：暴露给模型的静态描述，与具体实现解耦
export interface ToolSpec {
  // 工具名称
  name: string;
  // 工具描述（供模型理解）
  description: string;
  // 参数的 JSON Schema 声明
  parameters: Record<string, unknown>;
}

// 工具实现：声明 + 执行器，由任务环境提供，Agent 按任务 tools 列表绑定子集
export interface Tool extends ToolSpec {
  // 执行工具，结果序列化后作为 observation 回传
  execute(input: Record<string, unknown>): Promise<unknown>;
}

// 模型发起的一次工具调用请求
export interface ToolCall {
  // 调用唯一标识，用于与 tool 角色消息配对
  id: string;
  // 工具名称
  name: string;
  // 调用参数（已解析为对象）
  arguments: Record<string, unknown>;
}
