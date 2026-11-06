import { describe, expect, it } from 'vitest';
import type { PathSegment } from '@gisalgo/shared';
import {
  addModeToSequence,
  buildCrossModalDrawData,
  formatCrossModalSummary,
  isCrossModalSequence,
  MIN_CROSS_MODAL_MODES,
  modeColor,
  normalizeModeSequence,
  removeModeFromSequence,
} from './cross-modal-path.js';

function segment(
  mode: PathSegment['mode'],
  distance: number,
  coordinates: [number, number][],
  extra: Partial<PathSegment> = {},
): PathSegment {
  return {
    mode,
    distance,
    nodeIds: [],
    edgeIds: [],
    coordinates,
    ...extra,
  };
}

describe('模态序列的增删与规范化', () => {
  it('去重并保持给定顺序', () => {
    expect(normalizeModeSequence(['car', 'walk', 'car', 'bus', 'walk'])).toEqual([
      'car',
      'walk',
      'bus',
    ]);
  });

  it('少于 2 个模态时视为未启用跨模态', () => {
    expect(isCrossModalSequence([])).toBe(false);
    expect(isCrossModalSequence(['car'])).toBe(false);
    expect(isCrossModalSequence(['car', 'car'])).toBe(false);
    expect(isCrossModalSequence(['car', 'walk'])).toBe(true);
    expect(MIN_CROSS_MODAL_MODES).toBe(2);
  });

  it('追加模态时排到末尾；已存在则不重复', () => {
    expect(addModeToSequence(['car'], 'walk')).toEqual(['car', 'walk']);
    expect(addModeToSequence(['car', 'walk'], 'bus')).toEqual(['car', 'walk', 'bus']);
    expect(addModeToSequence(['car', 'walk'], 'car')).toEqual(['car', 'walk']);
  });

  it('移除模态后其余保持原有顺序', () => {
    expect(removeModeFromSequence(['car', 'walk', 'bus'], 'walk')).toEqual(['car', 'bus']);
    expect(removeModeFromSequence(['car'], 'bike')).toEqual(['car']);
  });
});

describe('模态配色', () => {
  it('每个模态有固定的 RGBA 颜色', () => {
    expect(modeColor('car')).toEqual([242, 198, 109, 255]);
    expect(modeColor('walk')).toEqual([127, 214, 160, 255]);
    expect(modeColor('bike')).toEqual([127, 199, 232, 255]);
    expect(modeColor('bus')).toEqual([232, 163, 92, 255]);
  });
});

describe('segments → 绘制数据', () => {
  const segments: PathSegment[] = [
    segment('car', 1200, [
      [114.3, 30.5],
      [114.31, 30.51],
    ]),
    segment('walk', 800, [
      [114.32, 30.52],
      [114.33, 30.53],
    ]),
  ];

  it('每段带自己的坐标与模态颜色', () => {
    const { segmentPaths } = buildCrossModalDrawData(segments);
    expect(segmentPaths).toHaveLength(2);
    expect(segmentPaths[0]?.mode).toBe('car');
    expect(segmentPaths[0]?.color).toEqual(modeColor('car'));
    expect(segmentPaths[1]?.coordinates).toEqual([
      [114.32, 30.52],
      [114.33, 30.53],
    ]);
  });

  it('换乘点标记取相邻两段端点坐标的中点', () => {
    const { transferMarkers } = buildCrossModalDrawData(segments);
    expect(transferMarkers).toHaveLength(1);
    // 前段终点 [114.31, 30.51] 与后段起点 [114.32, 30.52] 的中点
    expect(transferMarkers[0]?.position).toEqual([114.315, 30.515]);
  });

  it('转换点 id 优先取前段的 toTransferPoint，其次后段的 fromTransferPoint', () => {
    const withIds = buildCrossModalDrawData([
      segment('car', 100, [[0, 0]], { toTransferPoint: 42 }),
      segment('walk', 100, [[1, 1]], { fromTransferPoint: 42 }),
    ]);
    expect(withIds.transferMarkers[0]?.transferPointId).toBe(42);

    const fromNext = buildCrossModalDrawData([
      segment('car', 100, [[0, 0]]),
      segment('walk', 100, [[1, 1]], { fromTransferPoint: 7 }),
    ]);
    expect(fromNext.transferMarkers[0]?.transferPointId).toBe(7);

    const none = buildCrossModalDrawData(segments);
    expect(none.transferMarkers[0]?.transferPointId).toBeNull();
  });

  it('单段路径没有换乘点', () => {
    const { segmentPaths, transferMarkers } = buildCrossModalDrawData([segments[0] as PathSegment]);
    expect(segmentPaths).toHaveLength(1);
    expect(transferMarkers).toHaveLength(0);
  });
});

describe('跨模态摘要文案', () => {
  const segments: PathSegment[] = [segment('car', 1200, [[0, 0]]), segment('walk', 800, [[1, 1]])];

  it('距离口径按 km/m 展示并给出换乘次数与总计', () => {
    expect(formatCrossModalSummary(segments, 'distance')).toBe(
      '汽车 1.2 km → 步行 800 m · 换乘 1 处 · 共 2.0 km',
    );
  });

  it('时间口径用时分展示', () => {
    // 1200 秒 = 20 分钟，800 秒 ≈ 13.3 分钟
    expect(formatCrossModalSummary(segments, 'time')).toBe(
      '汽车 20.0 分钟 → 步行 13.3 分钟 · 换乘 1 处 · 共 33.3 分钟',
    );
  });

  it('超过一小时按小时展示', () => {
    const long = [segment('car', 7200, [[0, 0]])];
    expect(formatCrossModalSummary(long, 'time')).toContain('2 小时 0 分');
  });
});
