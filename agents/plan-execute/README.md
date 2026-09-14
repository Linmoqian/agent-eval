# plan-execute Agent

先规划后执行架构（`plan_execute_agent.ts`）：单模型两阶段——

```
Phase 1 planning   : 模型（无工具）输出 JSON 字符串数组计划 → plan_created
Phase 2 executing  : 顺序执行各步；步内允许工具循环，模型回文本即该步完成
Phase 3 finalizing : 执行完全部步骤后让模型总结
```

结构特点：

- 计划只生成一次，顺序执行不回头；步失败只记 `step_failed`，不触发重规划
- 执行阶段贯穿单一消息历史（planning 与 executing 共用同一模型实例）
- 计划解析失败时降级为直接作答，真伪交给评估器

Trace 事件形态：

```text
agent_state(planning/executing/finalizing), plan_created × 1,
plan_updated(step_started/step_completed/step_failed), model_call/model_response, tool_call/tool_result
```
