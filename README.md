# agent-eval

Agent 评估框架（TypeScript）。

## 目录结构

- `core/` 核心抽象：`Task`、`Agent`、`Model`、`Tool`、`Trace`、`Evaluator`
- `agents/` Agent 实现：raw / react / tool-loop / plan-execute / planner-executor
- `models/` 模型适配：openai / anthropic / gemini / qwen / local
- `tasks/` 任务集：planning / coding / tool-use / reasoning / robotics
- `evaluators/` 评估器：success / efficiency / robustness / cost / stability
- `runner/` 批量评估入口（`benchmark.ts`）
- `results/` 评估结果输出（不入库）

## 使用

```bash
npm install
npm run typecheck
```

## 核心接口（统一输入协议）

三个协议实现控制变量：任务、Agent、模型完全解耦。

### Task：标准任务定义

任务以 JSON 落盘于 `tasks/<category>/`，字段见示例 `tasks/planning/robot_path_001.json`：

- `task_id` 唯一标识、`category` 类别、`instruction` 自然语言指令
- `input` 任务输入、`tools` 允许的工具名列表
- `constraints` 约束（`max_steps` / `max_time` 等）、`ground_truth` 期望结果

加载时用 `validateTask(raw)` 校验并窄化为 `Task`，Agent 架构无论怎么变，都只拿到这一份任务。

### Agent：统一架构协议

`core/agent.ts`，所有架构实现同一接口，输入输出完全一致：

```ts
interface Agent {
  name: string
  init(config: AgentConfig): Promise<void>  // 注入 model 与工具池
  run(task: Task): Promise<AgentResult>      // 产出 trace + 汇总指标
  reset(): Promise<void>                     // 清空状态，复用实例
}
```

`AgentConfig.model` 是 `Model` 接口实例，Agent 不感知具体厂商。

### Model：统一模型协议

`core/model.ts`，各厂商适配器实现 `generate(messages, options?)`，返回统一的 `ModelResponse`（`content` / `toolCalls` / `usage` / `finishReason`）。换模型只需换适配器实例：

```ts
const agent = new ReactAgent({ model: new QwenModel("qwen-max") })
```

辅助类型：`Message` / `TokenUsage`（`model.ts`）、`ToolSpec` / `Tool` / `ToolCall`（`tool.ts`）、`TraceStep` / `Trace`（`trace.ts`），统一从 `core/index.ts` 导入。
