# robustness 鲁棒性评估器（M7）

鲁棒性首先是**实验条件**：故障由 `environments/fault_injector.ts` 在环境侧注入（包装工具，
Agent 与任务环境均不感知），本评估器只从 Trace 观察结果。观测协议：注入的故障在观测
JSON 中携带 `fault: { type, injected: true }` 标记。

## 指标

| 指标 | 派生源 |
| --- | --- |
| injectedFaults | `tool_result.observation` 含 `fault` 标记的事件数（全部类型） |
| faultTypes | 按类型计数：tool_failure / tool_timeout / observation_drop / observation_noise |
| failedByFault | 注入导致失败的调用数（failure / timeout） |
| recoveredFaults | 故障失败后，同一指纹（工具名+参数）调用再次出现且成功 |
| recoveryRate | `recoveredFaults / failedByFault`，无注入时为 null |

$$RecoveryRate = \frac{RecoveredFaults}{InjectedFaults}$$

恢复定义取"同指纹重试成功"（保守口径）；"换策略后成功"不计入 recovery，由
FaultSuccessRate（故障条件下任务最终成功率，Experiment 层聚合）与 success 评估器观察。

## 故障条件

旋钮与 profile 见 `core/fault.ts`：`clean / light / medium / heavy`，
`"profile:seed"` 形式指定种子（缺省 12345），同一种子同一调用序列 → 同一故障序列。
