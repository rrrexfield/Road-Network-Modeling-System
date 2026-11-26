/**
 * 拥堵系数与事件影响(Sprint 3 · 作业三):把权重从"静态限速"扩展为随时间变化的
 * **时间槽函数**,并支持路段级事件(临时封闭、事故降速)。
 *
 * 设计约束(issue #65):
 * 1. **确定性可复现**——同一组输入(钟点、曲线、事件)两次运行得到同一组结果;
 *    全部为查表与线性插值,不用随机噪声,答辩可当场复现;
 * 2. **可解释、可配置**——曲线是显式锚点表,事件是显式列表,每项都有物理含义;
 * 3. **合成顺序钉死**(A 冻结契约时引用):
 *      有效速度(km/h) = (覆盖限速 ?? 模态默认限速) × 全局速度系数 ÷ 拥堵系数 × 事件乘子
 *      通行时间(秒)   = 里程 / 有效速度 = 基础时间 × 拥堵系数 ÷ 事件乘子
 *    即**拥堵系数乘在时间上**(1 = 不拥堵,1.85 = 慢 85%,0.85 = 畅通快 15%),
 *    **事件降速乘子乘在速度上**(0.4 = 剩余 40% 通行能力);两者方向不同,
 *    因为拥堵的常识表达是"比平时慢多少",事件的常识表达"还剩几成通行能力"。
 *    里程(distance)口径不受拥堵与事故降速影响,但**封闭事件**同样作用于
 *    distance——封闭是"不可通行"而非"变慢"。
 *
 * 本模块只定义参数模型与纯函数;边权合成在 mode-weight.ts,REST 解析在 routes.ts。
 */

/** 拥堵日曲线锚点:[钟点(0–24), 拥堵系数]。系数 1 = 不拥堵,>1 = 慢于限速,<1 = 畅通。 */
export type CongestionAnchor = readonly [hour: number, factor: number];

/**
 * 默认拥堵日曲线:按城市早晚高峰的常识取锚点,槽内系数由锚点线性插值。
 * 数值为演示用常识估计(非实测标定),答辩时可说明"确定性模拟"口径。
 */
export const DEFAULT_CONGESTION_CURVE: readonly CongestionAnchor[] = [
  [0, 0.85],
  [5, 0.85],
  [7, 1.7],
  [9, 1.85],
  [12, 1.15],
  [14, 1.1],
  [17, 1.75],
  [19, 1.8],
  [21, 1.1],
  [23, 0.9],
  [24, 0.85],
];

/**
 * 等级拥堵敏感度(乘子):同等全局拥堵下不同等级的放大/折减。
 * 主干路接近全局值,支路与巷道受拥堵影响小(拥堵集中在干路)。
 */
export const DEFAULT_HIGHWAY_SENSITIVITY: Readonly<Record<string, number>> = {
  motorway: 1,
  motorway_link: 1,
  trunk: 1,
  trunk_link: 1,
  primary: 1.05,
  primary_link: 1,
  secondary: 1,
  secondary_link: 0.95,
  tertiary: 0.9,
  tertiary_link: 0.85,
  residential: 0.7,
  unclassified: 0.7,
  road: 0.7,
  living_street: 0.6,
  service: 0.5,
  unknown: 0.8,
};

/** 拥堵参数:时间槽 + 日曲线 + 等级敏感度。 */
export interface CongestionProfile {
  /** 时间槽长度(分钟),>0;默认 30,即一天 48 个槽,与 E 的时间轴动画对齐。 */
  slotMinutes: number;
  /** 日曲线锚点;槽系数取曲线在**槽中点**的线性插值值,槽内恒定(保证确定性)。 */
  curve: readonly CongestionAnchor[];
  /** 等级 → 敏感度乘子;未收录等级按 1(与全局曲线一致)。 */
  highwaySensitivity: Readonly<Record<string, number>>;
}

/** 默认拥堵参数:30 分钟槽 + 默认日曲线 + 默认等级敏感度。 */
export const DEFAULT_CONGESTION_PROFILE: CongestionProfile = {
  slotMinutes: 30,
  curve: DEFAULT_CONGESTION_CURVE,
  highwaySensitivity: DEFAULT_HIGHWAY_SENSITIVITY,
};

/** 一天的总分钟数。 */
const MINUTES_PER_DAY = 1440;

/** 钟点约束在 [0, 24];越界输入按边界处理而不是报错(展示型输入宁可用边界值)。 */
export function clampHourOfDay(hourOfDay: number): number {
  if (!Number.isFinite(hourOfDay)) return 0;
  return Math.min(24, Math.max(0, hourOfDay));
}

/** 时间槽总数:ceil(1440 / slotMinutes);slotMinutes 非法时按 30 处理。 */
export function slotCount(slotMinutes: number): number {
  const minutes = Number.isFinite(slotMinutes) && slotMinutes > 0 ? slotMinutes : 30;
  return Math.ceil(MINUTES_PER_DAY / minutes);
}

/**
 * 钟点 → 时间槽下标。槽 i 覆盖 [i·slotMinutes, (i+1)·slotMinutes) 分钟;
 * hourOfDay=24 归入最后一个槽(与曲线末锚点衔接)。
 */
export function slotIndexForHour(hourOfDay: number, slotMinutes: number): number {
  const minutes = Number.isFinite(slotMinutes) && slotMinutes > 0 ? slotMinutes : 30;
  const index = Math.floor((clampHourOfDay(hourOfDay) * 60) / minutes);
  return Math.min(index, slotCount(minutes) - 1);
}

/** 曲线在给定钟点的线性插值值;锚点无序时先按钟点排序。复杂度 O(n),n=锚点数。 */
export function curveFactorAtHour(curve: readonly CongestionAnchor[], hourOfDay: number): number {
  if (curve.length === 0) return 1;
  const hour = clampHourOfDay(hourOfDay);
  const sorted = [...curve].sort((a, b) => a[0] - b[0]);
  if (hour <= sorted[0]![0]) return sorted[0]![1];
  const last = sorted[sorted.length - 1]!;
  if (hour >= last[0]) return last[1];
  for (let i = 1; i < sorted.length; i += 1) {
    const [h1, f1] = sorted[i]!;
    const [h0, f0] = sorted[i - 1]!;
    if (hour <= h1) return f0 + ((f1 - f0) * (hour - h0)) / (h1 - h0 || 1);
  }
  return last[1];
}

/**
 * 拥堵系数(乘子,>0):曲线在**当前时间槽中点**的插值 × 等级敏感度。
 * 槽内恒定 → 同一槽内任意两次查询结果逐位相同(确定性口径)。
 * @param profile 拥堵参数;缺省字段回退默认值。
 * @param hourOfDay 参考钟点(0–24)。
 * @param highway 等级;未收录敏感度按 1。
 * @remarks 复杂度 O(n)(锚点排序线性扫)。
 */
export function congestionFactorAt(
  profile: CongestionProfile,
  hourOfDay: number,
  highway?: string,
): number {
  const midHour =
    ((slotIndexForHour(hourOfDay, profile.slotMinutes) + 0.5) * profile.slotMinutes) / 60;
  const curveFactor = curveFactorAtHour(profile.curve, midHour);
  const sensitivity = highway === undefined ? 1 : (profile.highwaySensitivity[highway] ?? 1);
  return curveFactor * (Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1);
}

/**
 * 归一化外部输入的拥堵参数:非法字段回退默认值,不抛错(与 normalizeWeightProfile 同风格)。
 * @remarks 锚点只保留钟点∈[0,24] 且系数为正有限的项;空曲线回退默认曲线。
 */
export function normalizeCongestionProfile(
  raw?: Partial<CongestionProfile> | undefined,
): CongestionProfile {
  const slotMinutesRaw = raw?.slotMinutes;
  const slotMinutes =
    typeof slotMinutesRaw === 'number' && Number.isFinite(slotMinutesRaw) && slotMinutesRaw > 0
      ? Math.min(Math.max(slotMinutesRaw, 5), 1440)
      : DEFAULT_CONGESTION_PROFILE.slotMinutes;

  const curve: CongestionAnchor[] = [];
  for (const anchor of raw?.curve ?? DEFAULT_CONGESTION_CURVE) {
    const [hour, factor] = anchor;
    if (Number.isFinite(hour) && hour >= 0 && hour <= 24 && Number.isFinite(factor) && factor > 0) {
      curve.push([hour, factor]);
    }
  }

  const highwaySensitivity: Record<string, number> = {};
  for (const [highway, value] of Object.entries(
    raw?.highwaySensitivity ?? DEFAULT_HIGHWAY_SENSITIVITY,
  )) {
    if (Number.isFinite(value) && value > 0) highwaySensitivity[highway] = value;
  }

  return {
    slotMinutes,
    curve: curve.length > 0 ? curve : DEFAULT_CONGESTION_CURVE,
    highwaySensitivity,
  };
}

/** 事件类型:closure = 路段临时封闭(不可通行),incident = 事故降速(乘子 <1)。 */
export type TrafficEventKind = 'closure' | 'incident';

/** 路段级交通事件(确定性模拟,不接外部实时数据源,issue #65 边界)。 */
export interface TrafficEvent {
  /** 事件作用的 way 集合;按 way 粒度(与编辑器/演示"选一条路设事件"的操作一致)。 */
  wayIds: readonly number[];
  kind: TrafficEventKind;
  /** incident 的降速乘子(0,1),如 0.4 = 剩余 40% 通行能力;closure 忽略本字段。 */
  speedFactor?: number;
  /** 生效钟点区间 [start, end);缺省全天生效。end ≤ start 视为空区间(不生效)。 */
  activeHours?: readonly [start: number, end: number];
}

/** 事件在该钟点是否生效;activeHours 缺省全天生效。 */
function eventActiveAt(event: TrafficEvent, hourOfDay: number): boolean {
  const range = event.activeHours;
  if (range === undefined) return true;
  const [start, end] = range;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  return hourOfDay >= start && hourOfDay < end;
}

/** 事件查表项:closure 命中即不可通行;否则 incident 乘子连乘。 */
export interface EventEffect {
  closure: boolean;
  /** incident 乘子连乘结果;closure 为 true 时无意义。 */
  factor: number;
}

/**
 * 构建 wayId → 事件效果查表(按参考钟点过滤生效事件)。
 * 合成规则:**任一 closure 命中即不可通行**;多个 incident 按乘子**连乘**(事件独立)。
 * @remarks 复杂度 O(事件数 × way 数)。
 */
export function buildEventLookup(
  events: readonly TrafficEvent[] | undefined,
  hourOfDay: number,
): Map<number, EventEffect> {
  const lookup = new Map<number, EventEffect>();
  if (!events || events.length === 0) return lookup;
  for (const event of events) {
    if (!eventActiveAt(event, hourOfDay)) continue;
    for (const wayId of event.wayIds) {
      if (!Number.isFinite(wayId)) continue;
      if (event.kind === 'closure') {
        lookup.set(wayId, { closure: true, factor: 0 });
      } else {
        const factor =
          Number.isFinite(event.speedFactor) && (event.speedFactor as number) > 0
            ? (event.speedFactor as number)
            : 1;
        const existing = lookup.get(wayId);
        if (existing === undefined) {
          lookup.set(wayId, { closure: false, factor });
        } else if (!existing.closure) {
          existing.factor *= factor;
        }
      }
    }
  }
  return lookup;
}

/**
 * 一次查询的完整交通条件:钟点 + 拥堵参数 + 事件列表。
 * 作为 `createModeEdgeWeight` 的可选第 4 参注入;省略时行为与 Sprint 2 完全一致。
 */
export interface TrafficConditions {
  /** 参考钟点(0–24),决定时间槽与事件生效区间。 */
  hourOfDay: number;
  /** 拥堵参数;缺省用 DEFAULT_CONGESTION_PROFILE(congestion 未给出 = 启用默认曲线)。 */
  congestion?: CongestionProfile;
  /** 显式关闭拥堵(congestion=off 时由解析层置位);置位后只保留事件影响。 */
  congestionDisabled?: boolean;
  /** 事件列表(服务端预置的确定性模拟场景);缺省无事件。 */
  events?: readonly TrafficEvent[];
}

/** 查询串流量开关的合法取值:显式 off 关闭对应项,其余取值忽略。 */
export function isExplicitOff(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'off';
}
