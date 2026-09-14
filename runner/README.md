# M2 架构矩阵验证脚本（离线）

`demo.ts`：用剧本回放模型（ScriptedModel，零网络请求）让**同一个任务（robot_path_001）被 5 种架构完整运行**，行为全部进入统一 Trace：

```
Task → Agent → Model → Trace → Evaluator → Result
```

运行：

```bash
npm run build && npm run demo
```

预期对照结果（评估器与 Agent 解耦的价值所在）：

| Agent | Agent 自报 success | SuccessEvaluator passed | 结构差异（事件分布） |
|---|---|---|---|
| raw | true | **false**（完成 0/8） | 仅 model_call/response 各 1 |
| tool-loop | true | **true**（8/8） | 无 thought、可并行多工具 |
| react | true | **true**（8/8） | 每轮 1 条 thought、单动作串行 |
| plan-execute | true | **true**（8/8） | plan_created ×1、无计划修订 |
| planner-executor | true | **true**（8/8） | 失败观测 → replanning → plan_updated(revised) |

planner-executor 的剧本特意安排：Planner 初版计划把障碍格 (4,2) 当途经点 → Executor move 失败 → 回 Planner 重规划 → 修正后完成任务，用于验证「失败上抛 + 计划修订」结构（M7 恢复能力的基础）。

demo 同时断言：5 架构 trace 完整（含 model_call/model_response）、事件形态与架构预期一致。

接入真实模型：设置 `OPENAI_API_KEY`（可选 `OPENAI_MODEL`），将 `model` 换成 `model: "openai"` 即可，其余链路不变。
