// 任务定义：一次评估的基本单元，含输入、可用工具与期望结果
// 字段采用 snake_case，与任务 JSON 数据格式保持一致
// Created on 2026-09-11
// @author: https://github.com/Linmoqian

// 任务约束：步数、时限等，字段可按任务类型扩展
export interface TaskConstraints {
  // 最大迭代步数
  max_steps?: number;
  // 最大执行时间（秒）
  max_time?: number;
  // 允许任务类型自定义约束字段
  [key: string]: unknown;
}

// 标准任务：Agent 架构无论怎么变，都只拿到这一份任务
export interface Task {
  // 任务唯一标识
  task_id: string;
  // 任务类别：planning / coding / tool-use / reasoning / robotics
  category: string;
  // 自然语言指令
  instruction: string;
  // 任务输入（地图文件、代码路径等，由任务环境解释）
  input: Record<string, unknown>;
  // 本任务允许使用的工具名列表
  tools: string[];
  // 执行约束
  constraints?: TaskConstraints;
  // 期望结果，字段随任务类型而定，供 success 评估器判定
  ground_truth?: Record<string, unknown>;
}

// 任务校验失败错误
export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskValidationError";
  }
}

// 校验未知来源（JSON 文件 / 网络下发）的任务数据，通过后窄化为 Task
export function validateTask(raw: unknown): Task {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TaskValidationError("task 必须是 JSON 对象");
  }
  const obj = raw as Record<string, unknown>;

  const requireString = (key: string): string => {
    const value = obj[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new TaskValidationError(`task.${key} 必须是非空字符串`);
    }
    return value;
  };
  const requireOptionalObject = (key: string): Record<string, unknown> | undefined => {
    const value = obj[key];
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TaskValidationError(`task.${key} 必须是对象`);
    }
    return value as Record<string, unknown>;
  };

  // 三个必填字段
  const task_id = requireString("task_id");
  const category = requireString("category");
  const instruction = requireString("instruction");

  // input 可省略，默认空对象
  const input = requireOptionalObject("input") ?? {};

  // tools 可省略，默认空数组
  const rawTools = obj.tools ?? [];
  if (!Array.isArray(rawTools) || rawTools.some((t) => typeof t !== "string")) {
    throw new TaskValidationError("task.tools 必须是字符串数组");
  }
  const tools = rawTools as string[];

  // constraints / ground_truth 可选对象
  const constraints = requireOptionalObject("constraints") as TaskConstraints | undefined;
  const ground_truth = requireOptionalObject("ground_truth");

  return { task_id, category, instruction, input, tools, constraints, ground_truth };
}
