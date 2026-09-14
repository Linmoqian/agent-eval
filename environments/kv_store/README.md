# kv_store 任务环境

`tool-use` 类任务的键值存储：`read` / `write` / `erase` / `list` 四个工具的实现。

- 初值由任务 `input.initial` 提供，benchmark 按任务装载（`input.store === "kv"`）
- 观测协议：每个操作返回累计 `progress_completed`（成功操作数，供 ExecutionEfficiency 派生）；
  `list` / `read` 返回键值，`list` 观测含全量 `state` 快照（供 success 的 state 模式比对 `ground_truth.state`）
- 与 robot_world 相同：状态对 Agent 不可见，只能通过工具观测
