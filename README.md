# agent-eval

Agent 评估框架（TypeScript）。

## 目录结构

- `core/` 核心抽象：`Task`、`Agent`、`Model`、`Tool`、`Trace`（判别联合事件 + 统一 `record()` 收集器）、`Evaluator`
- `agents/` Agent 实现：raw / tool-loop / react / plan-execute / planner-executor
- `models/` 模型适配：openai / anthropic / gemini / qwen / local（含离线剧本回放 ScriptedModel）
- `tasks/` 任务集：planning / coding / tool-use / reasoning / robotics
- `environments/` 任务环境：工具实现与地图数据（M1：robot_world）
- `evaluators/` 评估器：success / efficiency / robustness / cost / stability
- `runner/` 批量评估入口（`benchmark.ts`）与链路验证脚本（`demo.ts`）
- `results/` 评估结果输出（不入库）

## 使用

```bash
npm install
npm run typecheck
npm run build && npm run demo   # 离线跑通 M1 全链路（零网络请求）
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

辅助类型：`Message` / `TokenUsage`（`model.ts`）、`ToolSpec` / `Tool` / `ToolCall`（`tool.ts`）、`TraceStep` / `Trace`（`trace.ts`），统一从 `core/index.ts` 导出。

## 评估解耦原则

**Agent 负责完成任务，Evaluator 负责评价任务**，二者只通过 `EvaluationContext` 交互：

```ts
interface EvaluationContext {
  task: Task;
  result: AgentResult;
  trace: Trace;
}

// 所有评估器都只是观测函数：E = f(Task, Result, Trace)
interface Evaluator<T = unknown> {
  name: string;
  evaluate(context: EvaluationContext): Promise<EvaluationResult<T>>;
}
```

`Trace` 不由 Agent 随意维护，而是统一事件收集器：Agent 只产生事件，框架负责编号与计时，后续 tool_calls / latency / tokens / 失败位置均可从 Trace 派生。事件为判别联合，架构比较时数据结构不会碎掉：

```ts
type TraceEvent =
  | ModelCallEvent      // 发起模型调用（round / purpose / 上下文规模）
  | ModelResponseEvent  // 收到响应（content / toolCalls / usage / finishReason）
  | ThoughtEvent        // 推理步骤（ReAct 的 Reason，source: model | agent）
  | ToolCallEvent       // 发起工具调用
  | ToolResultEvent     // 工具观测（ok / durationMs）
  | PlanCreatedEvent    // 计划创建（steps 快照）
  | PlanUpdatedEvent    // 计划更新（step_* / revised）
  | AgentStateEvent     // phase 变迁（planning / executing / replanning / finalizing）
  | ErrorEvent;         // 错误（fatal 标记）

const trace = createTrace(task.task_id, agent.name);
trace.record({ kind: "model_call", round: 1, purpose: "act" });
trace.record({ kind: "model_response", usage, content, toolCalls });
trace.record({ kind: "tool_call", call });
trace.record({ kind: "tool_result", callId, name, observation, ok });
```

`model_call` 与 `model_response` 成对出现，两个事件的 timestamp 差即单次模型调用延迟；工具同理。

## 里程碑进度

```text
M0 Core Protocol        ✅
M1 Minimal Benchmark    ✅ robot_path_001 × {raw, tool-loop} × {openai, scripted} × success
M2 Agent Architectures  ✅ raw / tool-loop / react / plan-execute / planner-executor × 统一 Trace 事件
M3 Model Adapters       ⬜ openai-compatible 矩阵（deepseek/glm/kimi/grok）+ anthropic / gemini / local
M4 Metrics & Experiment ⬜ efficiency / cost / stability + Experiment 聚合层
M5 Batch Runner         ⬜ tasks × agents × models × runs 实验调度器
M6 Behavior Metrics     ⬜ tool_error_rate / redundancy / plan_revision_count / recovery
M7 Robustness           ⬜ FaultInjector（工具超时/异常/噪声观测）+ recovery_rate
M8 Task Suite           ⬜ 每 category easy/medium/hard
M9 Stats & Viz          ⬜ 统计检验、ArchitectureGain × ModelGain 矩阵可视化
```

M2 验证方式：`npm run build && npm run demo`（5 架构离线剧本验证，详见 `runner/README.md`）。
接入真实模型：设 `OPENAI_API_KEY`（可选 `OPENAI_MODEL`），`benchmark({ ..., model: "openai" })`。
