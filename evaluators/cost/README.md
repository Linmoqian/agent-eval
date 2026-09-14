# cost 评估器（Run 级）

`cost_evaluator.ts`：token 用量 × 价格元数据估算费用——

```text
estimatedCostUsd = inputTokens/1M × inputPerMillion + outputTokens/1M × outputPerMillion
```

价格独立维护在 `core/pricing.ts`（`ModelPricing` + 手工价格表），因为**价格属于模型元数据，不属于推理行为**；表未收录的模型返回 `priced=false / estimatedCostUsd=null` 而非报错。查价策略：先精确匹配，再取最长前缀（覆盖带日期后缀的快照名）。

价格表是公开标价快照，可能过期；调整 `PRICING_TABLE` 即可，无需动评估器。
