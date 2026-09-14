# runner：实验调度层

```text
benchmark.ts        单次运行：Task → Agent → Model → Trace → Run 级评估器 → 报告
experiment.ts       实验调度：Task × Agent × Model × runs → Experiment（stability 聚合 + 目录落盘）
cli.ts              矩阵 CLI：全组合调度 + 汇总表 + ArchitectureGain 列
scripts.ts          robot_path_001 的 5 架构离线剧本构造器
demo.ts             M2 离线验证：5 架构 × 统一 Trace
demo_experiment.ts  M4/M5 离线验证：Experiment 聚合 + 三评估器 + exp 目录
```

## 使用

```bash
npm run demo              # M2 离线验证（零网络）
npm run demo:experiment   # M4/M5 离线验证（零网络）
npm run benchmark -- --tasks robot_path_001 --agents raw,react --models deepseek,openai --runs 3
```

## Run 与 Experiment

```text
Run         = benchmark()：一次任务执行 + Run 级评估（success/efficiency/cost）
Experiment  = runExperiment()：同一 Task×Agent×Model 重复 runs 次
              → RunSummary 聚合 → StabilityEvaluator（Experiment 级）
              → results/experiments/exp_xxxx/{config.json, summary.json, runs/run_001.json…}
```

CLI 汇总表按 task × agent × model 输出 `successRate / latencyMeanMs / tokensMean / archGain`；`archGain = Score(M,A,T) − Score(M,Raw,T)`（同任务同模型下相对 raw 基线的成功率增益，无基线时为 `-`）。

## 单实验失败不中断矩阵

CLI 对每个实验 try/catch：网络错误、预算耗尽等只记录为失败行，退出码 1，其余实验继续。厂商 key 缺失在循环前统一校验，提前失败。
