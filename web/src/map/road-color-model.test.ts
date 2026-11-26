import { describe, expect, it } from 'vitest';
import type { RoadFeature } from '@gisalgo/shared';
import {
  congestionColor,
  createRoadColorResolver,
  legendForRoadColorMode,
  mockCongestionFactor,
  roadSecondsPerKm,
  speedColor,
} from './road-color-model.js';

function road(highway: string): RoadFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [114.3, 30.5],
        [114.301, 30.5],
      ],
    },
    properties: { id: 1, highway, tags: {} },
  };
}

describe('路网颜色模型', () => {
  it('按当前权重速度表计算秒/公里并分档', () => {
    const feature = road('primary');
    const context = {
      speedTable: { primary: 60 },
      speedFactor: 2,
      speedOverridesKmh: {},
    };
    expect(roadSecondsPerKm(feature, context)).toBe(30);
    expect(speedColor(30)).toEqual([88, 220, 146, 240]);
    expect(speedColor(90)).toEqual([208, 173, 96, 205]);
    expect(speedColor(121)).toEqual([184, 116, 116, 162]);
  });

  it('拥堵使用正常、等待、异常三档语义色', () => {
    expect(congestionColor(1)).toEqual([104, 150, 122, 148]);
    expect(congestionColor(1.3)).toEqual([210, 170, 92, 210]);
    expect(congestionColor(1.8)).toEqual([244, 76, 76, 250]);
    expect(mockCongestionFactor('primary')).toBeGreaterThan(1.55);
  });

  it('模式 resolver 和公开图例使用同一分档', () => {
    const feature = road('primary');
    const context = { speedTable: { primary: 60 }, speedFactor: 1 };
    const speed = createRoadColorResolver('speed', context)(feature);
    const congestion = createRoadColorResolver('congestion', context)(feature);
    expect(speed).toEqual(speedColor(roadSecondsPerKm(feature, context)));
    expect(congestion).toEqual(congestionColor(mockCongestionFactor('primary')));
    expect(legendForRoadColorMode('speed')).toHaveLength(3);
    expect(legendForRoadColorMode('congestion')).toHaveLength(3);
    expect(legendForRoadColorMode('highway').length).toBeGreaterThanOrEqual(8);
  });
});
