# behavior 行为评估器（M6）

从 Trace 派生架构行为指标，回答"它们都成功了，但成功方式为什么不同"，不裁决任务成败。

## tool_usage.ts

| 指标 | 派生源 |
| --- | --- |
| toolCalls | `tool_call` 事件数 |
| uniqueToolCalls | 按 `工具名+参数` 指纹去重后的调用数 |
| invalidToolCalls | 配对 `tool_result.ok === false` 的调用数（未知工具/参数非法/执行异常/业务失败） |
| duplicateToolCalls | 与之前某次调用指纹完全相同的次数（不计首次） |
| toolValidity | `1 - invalidToolCalls / toolCalls`，无调用时为 null |
| toolRedundancy | `duplicateToolCalls / toolCalls`，无调用时为 null |

## planning.ts

| 指标 | 派生源 |
| --- | --- |
| modelCalls | `model_call` 事件数 |
| plansCreated | `plan_created` 事件数 |
| planRevisions | `plan_updated.change === "revised"` 事件数 |
| planningTokens | `model_call.purpose ∈ {plan, replan}` 配对响应的 usage 之和 |
| totalTokens | 全部 `model_response.usage` 之和 |
| planningOverhead | `planningTokens / totalTokens`，无 token 时为 null |

## errors.ts

| 指标 | 派生源 |
| --- | --- |
| errors | `error` 事件数 |
| fatalErrors | `error.fatal === true` 事件数 |
| messages | 错误消息样本（前 5 条，便于排障） |

三个评估器均为观测型：不定义绝对优劣分（tool-usage 以 toolValidity 作 score 例外），行为差异靠横向比较体现。ExecutionEfficiency（TaskProgress / ToolCalls）依赖任务进度元数据，留待 M8 任务套件带 difficulty/tags 后接入。
