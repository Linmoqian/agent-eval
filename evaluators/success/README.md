# success 评估器

完成度评估（`success_evaluator.ts`）：只回答一个问题——任务到底完成了没有。

- 输入为 `EvaluationContext = { task, result, trace }`，不进入 Agent 内部
- 判定逻辑：扫描 Trace 中所有 observation 的 `completed_targets` 字段取最大值，与 `ground_truth.targets` 比较
- Agent 自报的 `result.success` 仅作参考，最终裁决以评估器为准
