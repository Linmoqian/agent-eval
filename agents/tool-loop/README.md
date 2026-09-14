# tool-loop Agent

工具循环架构（`tool_loop_agent.ts`）：标准 Agent 循环——

```
while 模型返回 tool_calls:
    执行工具 → observation 回传 → 下一轮
直到模型返回文本 / 步数耗尽 / 出错
```

每轮模型调用记 `model_call` 步，每次工具调用记 `action` + `observation` 步，Agent 只产生事件、Trace 统一收集。
