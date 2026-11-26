import { highwayColor, type RoadFeature } from '@gisalgo/shared';

export type RoadColorMode = 'highway' | 'speed' | 'congestion';
export type RoadColor = [number, number, number, number];

export interface RoadColorSpeedContext {
  speedFactor?: number;
  speedOverridesKmh?: Readonly<Record<string, number>>;
  speedTable?: Readonly<Record<string, number>>;
}

export interface RoadColorLegendItem {
  label: string;
  color: RoadColor;
}

const FALLBACK_SPEED_KMH: Readonly<Record<string, number>> = {
  motorway: 100,
  trunk: 80,
  primary: 60,
  secondary: 50,
  tertiary: 40,
  residential: 30,
  unclassified: 30,
  service: 15,
  living_street: 10,
  footway: 5,
  path: 5,
  cycleway: 15,
  steps: 3,
};

/**
 * 首版拥堵表达使用确定性 mock 数据，只用于颜色模型联调。
 * 接入 D 的 /api/weights/traffic 后替换这一层，不把它当作实时交通结果。
 */
const MOCK_CONGESTION_FACTOR: Readonly<Record<string, number>> = {
  motorway: 0.9,
  motorway_link: 0.95,
  trunk: 1.25,
  trunk_link: 1.2,
  primary: 1.85,
  primary_link: 1.7,
  secondary: 1.45,
  secondary_link: 1.35,
  tertiary: 1.2,
  tertiary_link: 1.15,
  residential: 0.9,
  unclassified: 0.9,
  living_street: 0.8,
  service: 0.7,
};

// 车速表达:绿 > 黄 > 红的饱和度/不透明度，与拥堵表达的强调方向相反。
const SPEED_OK: RoadColor = [88, 220, 146, 240];
const SPEED_WAIT: RoadColor = [208, 173, 96, 205];
const SPEED_BAD: RoadColor = [184, 116, 116, 162];

// 拥堵表达:红 > 黄 > 绿的饱和度/不透明度，降低畅通道路的视觉噪声。
const CONGESTION_OK: RoadColor = [104, 150, 122, 148];
const CONGESTION_WAIT: RoadColor = [210, 170, 92, 210];
const CONGESTION_BAD: RoadColor = [244, 76, 76, 250];

const SPEED_LEGEND: readonly RoadColorLegendItem[] = [
  { label: '≤ 60 秒/km', color: SPEED_OK },
  { label: '60–120 秒/km', color: SPEED_WAIT },
  { label: '> 120 秒/km', color: SPEED_BAD },
];

const CONGESTION_LEGEND: readonly RoadColorLegendItem[] = [
  { label: '≤ 1.15×', color: CONGESTION_OK },
  { label: '1.15–1.55×', color: CONGESTION_WAIT },
  { label: '> 1.55×', color: CONGESTION_BAD },
];

const HIGHWAY_LEGEND: readonly RoadColorLegendItem[] = [
  { label: '高速', color: highwayColor('motorway') },
  { label: '快速路', color: highwayColor('trunk') },
  { label: '主干路', color: highwayColor('primary') },
  { label: '次干路', color: highwayColor('secondary') },
  { label: '支路', color: highwayColor('tertiary') },
  { label: '居住道路', color: highwayColor('residential') },
  { label: '服务道路', color: highwayColor('service') },
  { label: '自行车道', color: highwayColor('cycleway') },
  { label: '步道', color: highwayColor('footway') },
];

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function baseSpeedKmh(highway: string, context: RoadColorSpeedContext): number {
  return positive(
    context.speedOverridesKmh?.[highway] ??
      context.speedTable?.[highway] ??
      FALLBACK_SPEED_KMH[highway],
    30,
  );
}

export function mockCongestionFactor(highway: string): number {
  return MOCK_CONGESTION_FACTOR[highway] ?? 0.85;
}

/** 当前权重配置下的车速，单位 km/h。 */
export function roadSpeedKmh(feature: RoadFeature, context: RoadColorSpeedContext): number {
  return baseSpeedKmh(feature.properties.highway, context) * positive(context.speedFactor, 1);
}

/** 行程时间口径：秒/公里；道路不可通行时返回 Infinity。 */
export function roadSecondsPerKm(feature: RoadFeature, context: RoadColorSpeedContext): number {
  const speed = roadSpeedKmh(feature, context);
  return speed > 0 ? 3600 / speed : Number.POSITIVE_INFINITY;
}

export function speedColor(secondsPerKm: number): RoadColor {
  if (!Number.isFinite(secondsPerKm)) return SPEED_BAD;
  if (secondsPerKm <= 60) return SPEED_OK;
  if (secondsPerKm <= 120) return SPEED_WAIT;
  return SPEED_BAD;
}

export function congestionColor(factor: number): RoadColor {
  if (!Number.isFinite(factor) || factor > 1.55) return CONGESTION_BAD;
  if (factor > 1.15) return CONGESTION_WAIT;
  return CONGESTION_OK;
}

/**
 * 为 deck.gl PathLayer 创建稳定 resolver。
 *
 * resolver 按 highway 缓存结果，避免约 5.5 万条 Way 在每次图层重建时重复做
 * 速度合成和分档；权重配置变化时重新创建 resolver 即可刷新缓存。
 */
export function createRoadColorResolver(
  mode: RoadColorMode,
  context: RoadColorSpeedContext = {},
): (feature: RoadFeature) => RoadColor {
  const cache = new Map<string, RoadColor>();
  return (feature) => {
    const highway = feature.properties.highway;
    const key = `${mode}:${highway}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    let color: RoadColor;
    if (mode === 'highway') color = highwayColor(highway);
    else if (mode === 'speed') color = speedColor(roadSecondsPerKm(feature, context));
    else color = congestionColor(mockCongestionFactor(highway));

    cache.set(key, color);
    return color;
  };
}

export function legendForRoadColorMode(mode: RoadColorMode): readonly RoadColorLegendItem[] {
  if (mode === 'speed') return SPEED_LEGEND;
  if (mode === 'congestion') return CONGESTION_LEGEND;
  return HIGHWAY_LEGEND;
}
