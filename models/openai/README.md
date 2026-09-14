# openai 模型适配器

OpenAI Chat Completions 适配器（`openai_model.ts`）：原生 `fetch` 直调 REST API，零第三方依赖。

- API Key 从 `process.env.OPENAI_API_KEY` 读取，可用 `OPENAI_MODEL` 指定模型（默认 `gpt-4o-mini`）
- 统一 `Message` ↔ OpenAI 消息格式互转，支持 function calling（tools）
- 网络失败 / 响应异常时抛出 `Error`，由 Agent 捕获记入 Trace
