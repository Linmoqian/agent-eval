# robot_world 任务环境

`planning` 类任务的机器人网格世界：`scan` / `move` / `clear` 三个工具的实现。

- `world_01.json`：地图数据（网格、起点、8 个目标点、障碍）
- `env.ts`：`RobotWorldEnv` 模拟器 + `createRobotWorldTools(mapName)` 工具工厂，由 benchmark 按任务 `input.map` 装载

约定：observation 为 JSON 字符串，其中 `completed_targets` / `total_targets` 字段供 `success` 评估器从 Trace 派生完成度，Agent 无需自报。
