# efficiency 评估器（Run 级）

`efficiency_evaluator.ts`：从 Trace 事件流派生执行效率观测——

```text
steps          事件总数
modelCalls     模型调用次数
toolCalls      工具调用次数
toolErrors     工具失败次数（tool_result.ok === false）
latencyMsTotal 模型调用总延迟（model_call → model_response 成对时间戳差）
latencyMsMean  模型调用平均延迟
durationMs     运行总时长（末事件时间戳）
inputTokens / outputTokens
```

观测型评估器：不定义绝对分数（score 恒 1），效率只在横向比较中有意义（M5 实验矩阵的同列对比）。`passed = 无 fatal error 事件`。
