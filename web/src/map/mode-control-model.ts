import type { TravelMode } from '@gisalgo/shared';

export type DisplayMode = 'all' | TravelMode;

export interface TravelModeOption {
  mode: DisplayMode;
  label: string;
}

/** 交通模式按钮的固定顺序和中文名称。 */
export const TRAVEL_MODE_OPTIONS: readonly TravelModeOption[] = [
  { mode: 'all', label: '全量' },
  { mode: 'car', label: '汽车' },
  { mode: 'walk', label: '步行' },
  { mode: 'bike', label: '骑行' },
  { mode: 'bus', label: '公交' },
];

/** 从模式值读取界面名称。 */
export function travelModeLabel(mode: DisplayMode): string {
  return TRAVEL_MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}
