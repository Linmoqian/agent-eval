// robot_path_001 的离线剧本构造器：5 种架构各自的确定性回放序列
// 独立模块避免导入副作用（demo / demo_experiment 共用）
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import {
  ScriptedModel,
  scriptedToolCall,
  type ScriptedResponse
} from "../models/local/scripted_model.js";

// robot_path_001 的 8 个目标点
const TARGETS: [number, number][] = [
  [2, 1], [5, 3], [1, 6], [7, 7],
  [9, 2], [4, 8], [6, 5], [8, 9]
];

// ===== raw 剧本：无工具，模型只能给文本答案（对照组）=====
export function buildRawScript(): ScriptedResponse[] {
  return [{ content: "根据地图，应该依次访问 8 个目标点（规划建议，未实际执行）。" }];
}

// ===== tool-loop 剧本：无显式推理，盲循环的典型行为是重复调用（无记忆/不信任观测）=====
export function buildToolLoopScript(): ScriptedResponse[] {
  return [
    { toolCalls: [scriptedToolCall("scan", {}), scriptedToolCall("clear", { x: 4, y: 2 })] },
    // 不信任首轮观测，重复扫描（重复调用 #1）
    { toolCalls: [scriptedToolCall("scan", {})] },
    ...TARGETS.map(([x, y]) => ({ toolCalls: [scriptedToolCall("move", { x, y })] })),
    // 无状态跟踪，盲目重走首个目标（重复调用 #2）
    { toolCalls: [scriptedToolCall("move", { x: TARGETS[0][0], y: TARGETS[0][1] })] },
    { content: "已扫描地图、清除障碍并依次到达全部 8 个目标点，任务完成。" }
  ];
}

// ===== react 剧本：每轮 Thought 文本 + 恰好一个 Action =====
export function buildReactScript(): ScriptedResponse[] {
  const script: ScriptedResponse[] = [
    {
      content: "Thought: 8 个目标点分布分散，先扫描确认地图布局与障碍。",
      toolCalls: [scriptedToolCall("scan", {})]
    },
    {
      content: "Thought: 障碍 (4,2) 在规划路径附近，先清除以防移动受阻。",
      toolCalls: [scriptedToolCall("clear", { x: 4, y: 2 })]
    }
  ];
  for (const [x, y] of TARGETS) {
    script.push({
      content: `Thought: 前往目标点 (${x},${y})，移动后即可标记完成。`,
      toolCalls: [scriptedToolCall("move", { x, y })]
    });
  }
  // 观测未进入信念，对首个目标重复确认（重复调用 #1）
  script.push({
    content: "Thought: 不确定 (2,1) 是否已标记完成，再次移动确认。",
    toolCalls: [scriptedToolCall("move", { x: 2, y: 1 })]
  });
  script.push({ content: "Thought: 全部 8 个目标点已到达，任务完成，输出总结。" });
  return script;
}

// ===== plan-execute 剧本：planning 出 JSON 计划 → 逐步执行（toolCall + DONE）→ 总结 =====
export function buildPlanExecuteScript(): ScriptedResponse[] {
  const plan = JSON.stringify([
    "扫描地图获取机器人位置与目标状态",
    ...TARGETS.map(([x, y]) => `移动到目标点 (${x},${y})`)
  ]);
  const script: ScriptedResponse[] = [{ content: plan }];
  script.push({ toolCalls: [scriptedToolCall("scan", {})] });
  script.push({ content: "DONE" });
  for (const [x, y] of TARGETS) {
    script.push({ toolCalls: [scriptedToolCall("move", { x, y })] });
    script.push({ content: "DONE" });
  }
  script.push({ content: "计划全部步骤执行完毕，8 个目标点均已到达，任务完成。" });
  return script;
}

// ===== planner-executor 剧本：planner 与 executor 各自独立回放 =====
// planner 初版计划把障碍格 (4,2) 当途经点 → executor move 失败 → 回 planner 重规划 → 修正后完成
export function buildPlannerScripts(): { planner: ScriptedResponse[]; executor: ScriptedResponse[] } {
  const planner: ScriptedResponse[] = [
    {
      content: JSON.stringify([
        "扫描地图获取机器人位置与目标状态",
        "途经 (4,2) 并移动到该格",
        ...TARGETS.map(([x, y]) => `移动到目标点 (${x},${y})`)
      ])
    },
    {
      content: JSON.stringify(TARGETS.map(([x, y]) => `移动到目标点 (${x},${y})`))
    }
  ];
  const executor: ScriptedResponse[] = [];
  executor.push({ toolCalls: [scriptedToolCall("scan", {})] });
  executor.push({ content: "DONE" });
  executor.push({ toolCalls: [scriptedToolCall("move", { x: 4, y: 2 })] }); // 将观测到 obstacle 失败
  for (const [x, y] of TARGETS) {
    executor.push({ toolCalls: [scriptedToolCall("move", { x, y })] });
    executor.push({ content: "DONE" });
  }
  executor.push({ content: "修订计划执行完毕，8 个目标点全部到达，任务完成。" });
  return { planner, executor };
}

