# agent-eval

Agent 评估框架（TypeScript）。

## 目录结构

- `core/` 核心抽象：`Task`、`Agent`、`Model`、`Tool`、`Trace`（判别联合事件 + 统一 `record()` 收集器）、`Evaluator`（Run 级 / Experiment 级双协议）、`ModelPricing`
- `agents/` Agent 实现：raw / tool-loop / react / plan-execute / planner-executor
- `models/` 模型适配：openai-compatible（单一实现覆盖 openai/deepseek/glm/kimi/grok/gemini/qwen）+ local（离线剧本回放 ScriptedModel）
- `tasks/` 任务集：planning / coding / tool-use / reasoning / robotics
- `environments/` 任务环境：工具实现与地图数据（M1：robot_world）
- `evaluators/` 评估器：success / efficiency / cost / behavior（Run 级：tool-usage / planning / errors）+ stability（Experiment 级）
- `runner/` 实验调度：`benchmark.ts`（单次）、`experiment.ts`（多 run 聚合）、`cli.ts`（矩阵调度）、离线验证脚本（`demo.ts` / `demo_experiment.ts`）
- `results/` 评估结果输出（不入库）

## 使用

```bash
npm install
npm run typecheck
npm run build
npm run demo              # M2：5 架构离线验证（零网络请求）
npm run demo:experiment   # M4/M5：Experiment 聚合 + stability 离线验证
npm run benchmark -- --tasks robot_path_001 --agents raw,react,planner-executor --models deepseek,openai --runs 3
```

实验矩阵目录（Experiment 是一级对象）：

```text
results/experiments/exp_xxxx/
  config.json      实验配置（task × agent × model × runs）
  summary.json     stability 聚合 + 各 run 摘要
  runs/run_001.json …  全量单次报告（含完整 Trace）
```

模型为厂商 id（`openai`/`deepseek`/`zhipu`/`glm`/`moonshot`/`kimi`/`grok`/`gemini`/`qwen`）或 `provider:model` 覆盖形式（如 `zhipu:glm-4.5-air`）；key 从 `.env` 读（见 `.env.example`）。

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
const agent = new ReactAgent({ model: createCompatibleModel("deepseek") })
```

兼容厂商（openai/deepseek/glm/kimi/grok/gemini/qwen）共用 `models/openai-compatible/` 的单一实现，`{ baseUrl, apiKey, model }` 三元组切换；协议差异明显的（anthropic 原生 API 等）后续单独 adapter。

辅助类型：`Message` / `TokenUsage`（`model.ts`）、`ToolSpec` / `Tool` / `ToolCall`（`tool.ts`）、`TraceStep` / `Trace`（`trace.ts`），统一从 `core/index.ts` 导出。

## 评估分层：Run 与 Experiment

**Agent 负责完成任务，Evaluator 负责评价任务**，二者只通过上下文交互：

- Run 级（单次执行）：`Evaluator` 实现 `evaluate(context: EvaluationContext)`，输入 Task / Result / Trace，产出 `EvaluationResult[]`（success 裁决 + efficiency / cost 观测）
- Experiment 级（多次重复）：`ExperimentEvaluator` 实现 `evaluate(context: ExperimentContext)`，输入轻量 `RunSummary[]`，如 `StabilityEvaluator`

$$stability = f(run_1, run_2, \ldots, run_n)$$

成本价格独立于推理行为，维护在 `core/pricing.ts`（`ModelPricing`）。

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
M0 Core Protocol            ✅
M1 Minimal Benchmark         ✅ robot_path_001 × {raw, tool-loop} × {openai, scripted} × success
M2 Architecture Family       ✅ raw / tool-loop / react / plan-execute / planner-executor × 统一 Trace 事件
M3 Model Adapter Matrix      ✅ openai-compatible 单一实现覆盖 7 家兼容厂商（anthropic 原生 API 待补）
M4 Metrics System            ✅ success / efficiency / cost / stability + ModelPricing
M5 Experiment Runner         ✅ cli 矩阵调度：tasks × agents × models × runs，exp 目录结构 + ArchitectureGain 列
M6 Agent Behavior Metrics    ✅ tool-usage / planning / errors：从 Trace 派生 invalid / duplicate / planRevisions / planningOverhead
M7 Fault Injection           ⬜ FaultConfig（toolFailureRate / observationNoise 等）+ clean/light/medium/heavy profile + RecoveryRate
M8 Task Suite                ⬜ 每类 easy/medium/hard + difficulty/tags 元数据
M9 Real-Model Experiments    ⬜ 小矩阵起步（3 模型 × 5 架构 × 3 任务 × 10 runs）+ 固定 ExperimentConfig + Budget/Capability 双模式
M10 Statistical Analysis     ⬜ ArchitectureGain × ModelCapability 统计检验（模型越强，架构还重要吗）
M11 Visualization / Report   ⬜ 增益矩阵与趋势可视化
```

## 行为指标（M6）

全部从 Trace 事件派生，不增加 Agent 内部统计，定义见 `evaluators/behavior/README.md`：

```text
toolCalls / uniqueToolCalls / invalidToolCalls / duplicateToolCalls
ToolValidity   = 1 - invalidToolCalls / toolCalls
ToolRedundancy = duplicateToolCalls / toolCalls
plansCreated / planRevisions
PlanningOverhead = planningTokens / totalTokens   （purpose ∈ {plan, replan} 的调用占比）
errors / fatalErrors
```

`npm run demo` 末尾输出架构行为对比表：都成功的架构，成功方式各不相同（tool-loop 盲循环重复、planner-executor 失败重规划恢复）。ExecutionEfficiency（TaskProgress / ToolCalls）依赖任务进度元数据，待 M8 接入。
离线验证：`npm run demo`（M2）、`npm run demo:experiment`（M4/M5），均零网络请求。
真实模型：在 `.env` 填入对应厂商 key 后 `npm run benchmark -- --models deepseek --runs 3`。
