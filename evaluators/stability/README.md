# stability 评估器（Experiment 级）

`stability_evaluator.ts`：作用于同一 Task × Agent × Model 组合的**多次运行**（`ExperimentContext`），实现 `ExperimentEvaluator` 协议而非 Run 级 `Evaluator`：

$$stability = f(run_1, run_2, \ldots, run_n)$$

输出明细：

```json
{
  "runs": 20,
  "successRate": 0.85,
  "perEvaluator": {
    "success":     { "passRate": 0.85, "scoreMean": 0.91, "scoreStd": 0.07 },
    "efficiency":  { "passRate": 1.0,  "scoreMean": 1.0,  "scoreStd": 0.0 }
  },
  "latencyMeanMs": 4120,
  "latencyStdMs": 380,
  "tokensMean": 18300,
  "tokensStd": 640
}
```

- 得分定义：`score = success 评估器的 passRate`（成功率即稳定性核心度量），离散度记录在 `perEvaluator[].scoreStd` 与 `latencyStdMs`
- 标准差用样本口径（n - 1），n < 2 时为 0
- `passed = successRate >= 1`（全部 run 通过）
