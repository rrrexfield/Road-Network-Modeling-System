import { describe, expect, it } from 'vitest';
import {
  buildEdges,
  collectNodeIds,
  filterRoadWays,
  parseTags,
  prepare,
  type RawOsmJson,
} from './prepare-data';

const raw: RawOsmJson = {
  source_file: 'test.osm.pbf',
  nodes: [
    { id: 1, lat: 30.5, lon: 114.3, tags: [] },
    { id: 2, lat: 30.51, lon: 114.31, tags: [] },
    { id: 3, lat: 30.52, lon: 114.32, tags: [] },
    { id: 4, lat: 30.53, lon: 114.33, tags: [] },
    { id: 5, lat: 30.54, lon: 114.34, tags: [] },
  ],
  ways: [
    {
      id: 100,
      nds: [1, 2, 3, 4],
      tags: [
        { k: 'highway', v: 'primary' },
        { k: 'name', v: '人民路' },
        { k: 'oneway', v: 'yes' },
      ],
    },
    { id: 200, nds: [4, 5], tags: [{ k: 'building', v: 'yes' }] },
  ],
};

describe('parseTags', () => {
  it('将 {k,v} 数组转为对象', () => {
    expect(parseTags([{ k: 'highway', v: 'primary' }, { k: 'name', v: '人民路' }])).toEqual({
      highway: 'primary',
      name: '人民路',
    });
  });
});

describe('filterRoadWays', () => {
  it('只保留带 highway 标签的 way', () => {
    const ways = filterRoadWays(raw.ways);
    expect(ways).toHaveLength(1);
    expect(ways[0]?.id).toBe(100);
    expect(ways[0]?.highway).toBe('primary');
    expect(ways[0]?.name).toBe('人民路');
    expect(ways[0]?.tags['oneway']).toBe('yes');
  });
});

describe('collectNodeIds + buildEdges', () => {
  it('相邻 nds 对生成边,并按节点集合过滤', () => {
    const ways = filterRoadWays(raw.ways);
    const ids = collectNodeIds(ways);
    expect(ids.has(4)).toBe(true);
    expect(ids.has(5)).toBe(false);

    const edges = buildEdges(ways, ids);
    expect(edges).toEqual([
      { from: 1, to: 2, wayId: 100 },
      { from: 2, to: 3, wayId: 100 },
      { from: 3, to: 4, wayId: 100 },
    ]);
  });

  it('不传节点集合时不过滤', () => {
    const ways = filterRoadWays(raw.ways);
    const allWays = [
      ...ways,
      { id: 200, highway: 'service', tags: {}, nds: [4, 5] },
    ];
    expect(buildEdges(allWays)).toHaveLength(4);
  });
});

describe('prepare', () => {
  it('过滤节点与 way,产出元信息与 bbox', () => {
    const derived = prepare(raw, '2026-01-01T00:00:00Z');
    expect(derived.nodes).toEqual([
      [1, 30.5, 114.3],
      [2, 30.51, 114.31],
      [3, 30.52, 114.32],
      [4, 30.53, 114.33],
    ]);
    expect(derived.meta.wayCount).toBe(1);
    expect(derived.meta.nodeCount).toBe(4);
    expect(derived.meta.edgeCount).toBe(3);
    expect(derived.meta.source).toBe('test.osm.pbf');
    expect(derived.meta.bbox).toEqual([114.3, 30.5, 114.33, 30.53]);
  });
});
