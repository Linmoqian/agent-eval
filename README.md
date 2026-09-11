# agent-eval

Agent 评估框架（TypeScript）。

## 目录结构

- `core/` 核心抽象：`Task`、`Agent`、`Model`、`Tool`、`Trace`、`Evaluator`
- `agents/` Agent 实现：raw / react / tool-loop / plan-execute / planner-executor
- `models/` 模型适配：openai / anthropic / gemini / qwen / local
- `tasks/` 任务集：planning / coding / tool-use / reasoning / robotics
- `evaluators/` 评估器：success / efficiency / robustness / cost / stability
- `runner/` 批量评估入口（`benchmark.ts`）
- `results/` 评估结果输出（不入库）

## 使用

```bash
npm install
npm run typecheck
```
