# react Agent

ReAct 架构（`react_agent.ts`）：每轮显式交替推理与行动——

```
while 未完成:
    Thought（模型文本推理）→ Action（恰好一个工具调用）→ Observation
直到模型不再调用工具（最终答案）/ 步数耗尽 / 出错
```

与 tool-loop 的结构差异：

- 每轮模型文本记为 `thought` 事件（`source: "model"`），推理过程进入轨迹
- 单动作约束：每轮只执行第一个工具调用，同轮多余调用记入轨迹但不执行
- 无并行工具调用，轮数通常多于 tool-loop

Trace 事件形态（robot_path_001 一次通过运行的分布示例）：

```text
model_call × N, model_response × N, thought × N, tool_call × N-1, tool_result × N-1
```
