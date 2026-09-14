# M1 链路验证脚本（离线）

`demo.ts`：用剧本回放模型（ScriptedModel，零网络请求）跑通完整链路：

```
Task → Agent → Model → Trace → Evaluator → Result
```

运行：

```bash
npm run build && npm run demo
```

剧本固定为 robot_path_001 的解：`scan + clear` → 8 次 `move` → 总结。

预期对照结果（评估器与 Agent 解耦的价值所在）：

| Agent | Agent 自报 success | SuccessEvaluator passed |
|---|---|---|
| raw | true（模型正常作答） | **false**（轨迹无任何工具观测，完成 0/8） |
| tool-loop | true | **true**（完成 8/8） |

接入真实模型：设置 `OPENAI_API_KEY`（可选 `OPENAI_MODEL`），将 `model: "scripted-demo"` 换成 `model: "openai"` 即可，其余链路不变。
