import { describe, expect, it } from 'vitest';
import type { WayProperties } from '@gisalgo/shared';
import { CompressionWayIndex, collectCompressionProtectedNodes } from './index.js';

function index(second: Partial<WayProperties> = {}) {
  const first: WayProperties = {
    id: 1,
    highway: 'residential',
    tags: { maxspeed: '30', oneway: 'no', foot: 'yes' },
  };
  const next: WayProperties = { ...first, id: 2, ...second };
  return {
    first,
    query: new CompressionWayIndex(
      new Map([
        [1, first],
        [2, next],
      ]),
    ),
  };
}

describe('C压缩输入，不实现压缩算法', () => {
  it('同属性不同way与名称不强制断链，标签顺序不影响结果', () => {
    const { query } = index({
      name: '另一条路',
      tags: { foot: 'yes', oneway: 'no', maxspeed: '30' },
    });
    expect(query.hasBoundary(1, 2)).toBe(false);
    expect(query.hasBoundary(1, 1)).toBe(false);
  });

  it.each<Partial<WayProperties>>([
    { highway: 'primary' },
    { tags: { maxspeed: '60', oneway: 'no', foot: 'yes' } },
    { tags: { maxspeed: '30', oneway: 'yes', foot: 'yes' } },
    { tags: { maxspeed: '30', oneway: 'no', foot: 'no' } },
    { tags: { maxspeed: '30', oneway: 'no', foot: 'yes', 'maxspeed:forward': '20' } },
    { tags: { maxspeed: '30', oneway: 'no', foot: 'yes', 'access:conditional': 'no @ (night)' } },
  ])('相关属性变化保留边界：%j', (second) => {
    expect(index(second).query.hasBoundary(1, 2)).toBe(true);
  });

  it('快照不随原属性变化，结果冻结，未知way明确拒绝', () => {
    const { first, query } = index();
    first.tags.maxspeed = '100';
    expect(query.get(1).tags.maxspeed).toBe('30');
    expect(Object.isFrozen(query.get(1).tags)).toBe(true);
    expect(() => query.hasBoundary(1, 999)).toThrow('缺少道路属性');
  });

  it('合并当前禁转与换乘路网节点，去重并排除其他模式节点', () => {
    const turns = [2, 2],
      transfers = [2, 3, 999];
    const result = collectCompressionProtectedNodes(
      new Map([
        [1, 0],
        [2, 0],
        [3, 0],
      ]),
      {
        turnViaNodeIds: turns,
        transferNodeIds: transfers,
      },
    );
    expect([...result]).toEqual([2, 3]);
    result.clear();
    expect(turns).toEqual([2, 2]);
    expect(transfers).toEqual([2, 3, 999]);
  });
});
