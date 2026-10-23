import { describe, expect, it } from 'vitest';
import type { RoadFeature } from '@gisalgo/shared';
import { toPropertyViewModel } from './property-view-model.js';

function makeFeature(properties: Partial<RoadFeature['properties']> = {}): RoadFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [114.3, 30.5],
        [114.31, 30.51],
      ],
    },
    properties: { id: 42, highway: 'primary', tags: {}, ...properties },
  };
}

describe('toPropertyViewModel', () => {
  it('保留道路名称', () => {
    expect(toPropertyViewModel(makeFeature({ name: '珞喻路' })).name).toBe('珞喻路');
  });

  it('名称缺失时回落为「未命名道路」', () => {
    expect(toPropertyViewModel(makeFeature()).name).toBe('未命名道路');
    expect(toPropertyViewModel(makeFeature({ name: '   ' })).name).toBe('未命名道路');
  });

  it('Way ID 以字符串形式给出', () => {
    const vm = toPropertyViewModel(makeFeature({ id: 123456 }));
    expect(vm.wayId).toBe('123456');
    expect(vm.fields).toContainEqual({ label: 'Way ID', value: '123456' });
  });

  it('标签区排除 highway 与 name，其余全部保留且不截断', () => {
    const tags: Record<string, string> = { highway: 'primary', name: '珞喻路' };
    for (let i = 0; i < 12; i += 1) tags[`k${i}`] = `v${i}`;

    const vm = toPropertyViewModel(makeFeature({ tags }));

    expect(vm.tags).toHaveLength(12);
    expect(vm.tags.map((t) => t.label)).not.toContain('highway');
    expect(vm.tags.map((t) => t.label)).not.toContain('name');
    expect(vm.hasTags).toBe(true);
  });

  it('没有额外标签时 hasTags 为 false', () => {
    const vm = toPropertyViewModel(makeFeature({ tags: { highway: 'primary' } }));
    expect(vm.tags).toHaveLength(0);
    expect(vm.hasTags).toBe(false);
  });
});