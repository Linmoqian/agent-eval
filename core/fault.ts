// 故障注入协议：鲁棒性首先是实验条件，其次才是评估指标
// FaultConfig 描述实验条件（故障旋钮），FaultInjector 在环境侧实施，Evaluator 只观察结果
// Created on 2026-09-14
// @author: https://github.com/Linmoqian

// 故障旋钮：全部为独立概率（0~1），四类故障按固定顺序判定（failure → timeout → drop → noise）
export interface FaultConfig {
  // 工具调用直接失败（返回 ok:false 的注入观测）
  toolFailureRate?: number;
  // 工具调用模拟超时（等待后返回超时失败观测）
  toolTimeoutRate?: number;
  // 观测丢弃（工具执行成功，但 Agent 收不到任何信息）
  observationDropRate?: number;
  // 观测噪声（原观测保留，追加噪声字段）
  observationNoiseRate?: number;
}

// 故障等级预设：固定 profile 保证实验可复现，M9 真实实验按矩阵展开
export const FAULT_PROFILES: Record<string, FaultConfig> = {
  // 无故障基线
  clean: {},
  light: {
    toolFailureRate: 0.05
  },
  medium: {
    toolFailureRate: 0.15,
    observationDropRate: 0.05
  },
  heavy: {
    toolFailureRate: 0.3,
    toolTimeoutRate: 0.1,
    observationDropRate: 0.1,
    observationNoiseRate: 0.2
  }
};

// 缺省随机种子：固定值保证缺省配置可复现；需要多样化时显式换种子
export const DEFAULT_FAULT_SEED = 12345;

// 解析后的故障条件：profile 名 + 种子 + 实际旋钮
export interface ResolvedFault {
  // 预设名（clean / light / medium / heavy）
  profile: string;
  // 随机种子
  seed: number;
  // 生效的故障旋钮
  config: FaultConfig;
}

// 解析故障描述："medium" / "medium:42" / "clean"
// 形如 "profile:seed" 时覆盖缺省种子；未注册的 profile 报错并列出可用项
export function resolveFaultProfile(spec: string): ResolvedFault {
  const sep = spec.indexOf(":");
  const profileName = sep === -1 ? spec : spec.slice(0, sep);
  const seedText = sep === -1 ? undefined : spec.slice(sep + 1);

  const config = FAULT_PROFILES[profileName];
  if (config === undefined) {
    throw new Error(
      `未注册的故障 profile: ${profileName}（可用: ${Object.keys(FAULT_PROFILES).join(", ")}）`
    );
  }
  let seed = DEFAULT_FAULT_SEED;
  if (seedText !== undefined) {
    const parsed = Number(seedText);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`故障种子必须是非负整数，实际 "${seedText}"`);
    }
    seed = parsed;
  }
  return { profile: profileName, seed, config };
}
