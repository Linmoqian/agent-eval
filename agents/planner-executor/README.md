# planner-executor Agent

Planner / Executor 分离架构（`planner_executor_agent.ts`）：规划与执行是两个独立角色——

```
Planner（独立上下文）      Executor（独立上下文）
     │ 输出 JSON 计划           │ 按计划逐步执行
     │ plan_created             │ tool_call / tool_result
     ▲                          │
     └── 观测到失败 ◄───────────┘
         修订计划 → plan_updated(revised) → Executor 从新计划头继续
```

结构特点（与 plan-execute 的差异）：

- 两个角色各自维护独立消息上下文，可注入不同模型（`options.plannerModel`，缺省复用主模型）
- 执行中观测到工具失败（`tool_result.ok === false`）立即上抛 Planner 重规划，不在步内反复重试
- 重规划次数上限 `MAX_REPLANS = 3`，防止失败-重规划死循环
- 这是恢复能力（M7 FaultInjector → recovery_rate）的结构基础

benchmark 注入独立 planner 模型：

```ts
benchmark({
  task: "robot_path_001",
  agent: "planner-executor",
  model: executorModel,
  agentOptions: { plannerModel: plannerModel }
});
```

Trace 事件形态：

```text
agent_state(planning/executing/replanning/finalizing), plan_created,
plan_updated(step_started/step_completed/step_failed/revised),
model_call/model_response, tool_call/tool_result, error
```
