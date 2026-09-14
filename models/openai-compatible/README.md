# openai-compatible 统一模型适配器

单一 `OpenAICompatibleModel` 实现（`openai_compatible.ts`）覆盖所有 **Chat Completions 兼容厂商**，换厂商只是 `{ baseUrl, apiKey, model }` 配置差异，Agent 代码零改动：

```text
openai    https://api.openai.com/v1
deepseek  https://api.deepseek.com/v1
zhipu     https://open.bigmodel.cn/api/paas/v4      （别名 glm）
moonshot  https://api.moonshot.cn/v1                 （别名 kimi）
grok      https://api.x.ai/v1
qwen      https://dashscope.aliyuncs.com/compatible-mode/v1  （别名 dashscope）
gemini    https://generativelanguage.googleapis.com/v1beta/openai
```

## 使用

```ts
// 方式一：厂商 id + 环境变量（key 读 <VENDOR>_API_KEY，模型读 <VENDOR>_MODEL，缺省用预设默认模型）
const model = createCompatibleModel("deepseek");
const model = createCompatibleModel("zhipu", "glm-4.5-air"); // 覆盖模型

// 方式二：直接构造（任意兼容端点）
const model = new OpenAICompatibleModel({
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY!,
  model: "deepseek-chat"
});
```

- 原生 `fetch` 直调 REST，零第三方依赖
- 统一 `Message` ↔ Chat Completions 消息互转，支持 function calling
- key 缺失 / HTTP 非 2xx 时抛错，由 Agent 捕获记入 Trace

## 模型层布局

协议差异明显的厂商后续单独 adapter（目录保留占位）：

```text
models/
  openai-compatible/   ✅ 兼容族（openai/deepseek/glm/kimi/grok/gemini）
  anthropic/           ⬜ Messages API
  gemini/              ⬜ 原生 generateContent（当前走 openai 兼容端点）
  local/               ✅ ScriptedModel 剧本回放
```
