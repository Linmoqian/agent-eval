// 任务套件的离线剧本构造器：四类代表任务各自的确定性回放序列（demo_task_suite 用）
// 独立模块避免导入副作用
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import {
  scriptedToolCall,
  type ScriptedResponse
} from "../models/local/scripted_model.js";

// planning_hard_001（world_04）的 14 个目标点，按顺序访问
const WORLD04_TARGETS: [number, number][] = [
  [1, 1], [4, 2], [7, 3], [10, 4], [13, 5], [2, 6], [5, 7],
  [8, 8], [11, 9], [3, 3], [6, 5], [9, 6], [12, 1], [0, 8]
];

// planning_hard_001 × tool-loop：扫描后依次访问全部目标（teleport 语义，目的地均为目标格）
export function buildPlanningHardScript(): ScriptedResponse[] {
  return [
    { toolCalls: [scriptedToolCall("scan", {})] },
    ...WORLD04_TARGETS.map(([x, y]) => ({ toolCalls: [scriptedToolCall("move", { x, y })] })),
    { content: "已扫描地图并依次访问全部 14 个目标点，任务完成。" }
  ];
}

// tool_medium_001 × tool-loop：读改写链 + 状态写入 + list 确认
export function buildToolMediumScript(): ScriptedResponse[] {
  return [
    { toolCalls: [scriptedToolCall("read", { key: "counter" })] },
    { toolCalls: [scriptedToolCall("write", { key: "counter", value: 42 })] },
    { toolCalls: [scriptedToolCall("read", { key: "counter" })] },
    { toolCalls: [scriptedToolCall("write", { key: "status", value: "done" })] },
    { toolCalls: [scriptedToolCall("list", {})] },
    { content: "counter 已翻倍为 42，status 已写为 done，最终状态已确认。" }
  ];
}

// reasoning_medium_001 × raw：单次生成给出答案与理由（answer 模式判定）
export function buildReasoningMediumScript(): ScriptedResponse[] {
  return [
    {
      content:
        "不能。前提只说有些花很快凋谢，这部分花未必包含玫瑰；「所有玫瑰都是花」不能推出「有些玫瑰属于很快凋谢的花」。"
    }
  ];
}

// robotics_easy_001 × tool-loop：严格按指令序列执行三次移动
export function buildRoboticsEasyScript(): ScriptedResponse[] {
  return [
    { toolCalls: [scriptedToolCall("move", { x: 1, y: 1 })] },
    { toolCalls: [scriptedToolCall("move", { x: 3, y: 3 })] },
    { toolCalls: [scriptedToolCall("move", { x: 5, y: 7 })] },
    { content: "已按给定序列依次到达 (1,1)、(3,3)、(5,7)，执行完毕。" }
  ];
}
