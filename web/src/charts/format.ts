/**
 * 展示层数值格式化。所有面板共用,避免各面板各写一套口径。
 */

const COUNT_FORMAT = new Intl.NumberFormat('zh-CN');

/** 整数计数:12345 → "12,345"。 */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(Math.round(value));
}

/** 里程:1234.5 米 → "1.23 km"。 */
export function formatKilometers(meters: number): string {
  const kilometers = meters / 1000;
  if (kilometers >= 100) return `${COUNT_FORMAT.format(Math.round(kilometers))} km`;
  return `${kilometers.toFixed(2)} km`;
}

/** 一位小数里程,用于图表坐标轴。 */
export function roundKilometers(meters: number): number {
  return Math.round((meters / 1000) * 10) / 10;
}

/** 时长:秒 → "45 秒" / "12.3 分" / "3 小时 45 分"。 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} 分`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours} 小时 ${minutes} 分`;
}

/** 速度:60 → "60.0 km/h"。 */
export function formatSpeed(kmh: number): string {
  return `${kmh.toFixed(1)} km/h`;
}

/** 占比:0.256 → "25.6%"。 */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
