# tool-loop Agent

工具循环架构（`tool_loop_agent.ts`）：标准 Agent 循环——

```
while 模型返回 tool_calls:
    执行工具 → observation 回传 → 下一轮
直到模型返回文本 / 步数耗尽 / 出错
```

每轮模型调用记 `model_call` + `model_response` 成对事件，每次工具调用记 `tool_call` + `tool_result` 成对事件；无显式推理步骤，每轮可并行发起多个工具调用——这是与 react（显式 Thought + 单动作）的对照点。Agent 只产生事件、Trace 统一收集。
