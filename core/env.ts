// .env 加载器：零依赖解析 KEY=VALUE，显式环境变量优先，benchmark 入口统一调用
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

import { existsSync, readFileSync } from "node:fs";

// 加载 .env 到 process.env；文件不存在时静默跳过，已存在的环境变量不覆盖
// 返回本次实际加载的键数量
export function loadEnvFile(filePath: string): number {
  if (!existsSync(filePath)) return 0;

  let loaded = 0;
  const lines = readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过空行与注释
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // 去掉成对引号
    const unquoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
        ? value.slice(1, -1)
        : value;

    if (process.env[key] === undefined) {
      process.env[key] = unquoted;
      loaded += 1;
    }
  }
  return loaded;
}
