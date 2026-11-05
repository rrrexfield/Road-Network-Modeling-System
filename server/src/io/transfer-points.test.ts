import { describe, expect, it } from 'vitest';
import { extractTransferPoints, getTransferPoints } from './index';

const tags = (t: Record<string, string>) => Object.entries(t).map(([k, v]) => ({ k, v }));
const node = (id: number, t: Record<string, string> = {}, lat = 30, lon = 114) => ({
  id,
  lat,
  lon,
  tags: tags(t),
});

describe('转换点提取与模式查询', () => {
  it('保留真实地铁出入口而不仅是车站中心，仍仅属于步行接驳', () => {
    const data = extractTransferPoints({
      ways: [],
      nodes: [node(9, { railway: 'subway_entrance', ref: 'D1' })],
    });
    expect(data.points[0]).toMatchObject({ id: 18, kind: 'subway', position: [114, 30] });
    expect(getTransferPoints(data, 'walk')).toHaveLength(1);
    expect(getTransferPoints(data, 'bus')).toEqual([]);
  });
  it('提取真实标签并按模式分开，地铁不冒充公交轨道模式', () => {
    const data = extractTransferPoints({
      ways: [],
      nodes: [
        node(1, { highway: 'bus_stop', name: '公交站' }),
        node(2, { station: 'subway' }),
        node(3, { amenity: 'parking' }),
        node(4, { amenity: 'bicycle_parking' }),
        node(5),
      ],
    });
    expect(data.points.map((p) => [p.id, p.kind])).toEqual([
      [2, 'bus'],
      [4, 'subway'],
      [6, 'parking'],
      [8, 'parking'],
    ]);
    expect(getTransferPoints(data, 'walk')).toHaveLength(4);
    expect(getTransferPoints(data, 'car').map((p) => p.id)).toEqual([6]);
    expect(getTransferPoints(data, 'bike').map((p) => p.id)).toEqual([8]);
    expect(getTransferPoints(data, 'bus').map((p) => p.id)).toEqual([2]);
    expect(data.issues).toEqual([]);
  });

  it('node/way相同OSM ID不冲突，区域代表点标记来源方法', () => {
    const data = extractTransferPoints({
      nodes: [node(1, { amenity: 'parking' }), node(2, {}, 32, 116)],
      ways: [{ id: 1, nds: [1, 2, 1], tags: tags({ amenity: 'parking' }) }],
    });
    expect(data.points.map((p) => p.id)).toEqual([2, 3]);
    expect(data.points[1]?.position).toEqual([115, 31]);
    expect(data.sources[1]).toMatchObject({
      sourceType: 'way',
      sourceId: 1,
      positionMethod: 'bounding-box-center',
    });
  });

  it('节点缺失和非法坐标报告，不能由部分区域计算假位置', () => {
    const data = extractTransferPoints({
      nodes: [node(1), node(2, { highway: 'bus_stop' }, NaN)],
      ways: [{ id: 5, nds: [1, 99], tags: tags({ amenity: 'parking' }) }],
    });
    expect(data.points).toEqual([]);
    expect(data.issues.map((i) => i.reason)).toEqual([
      'missing-or-invalid-position',
      'missing-or-invalid-position',
    ]);
  });

  it('私有和条件权限排除，重复来源和不安全ID明确报告', () => {
    const data = extractTransferPoints({
      ways: [],
      nodes: [
        node(1, { amenity: 'parking', access: 'private' }),
        node(2, { amenity: 'parking', 'access:conditional': 'no @ (Mo-Fr)' }),
        node(3, { highway: 'bus_stop' }),
        node(3, { highway: 'bus_stop' }),
        node(Number.MAX_SAFE_INTEGER, { highway: 'bus_stop' }),
      ],
    });
    expect(data.points).toHaveLength(1);
    expect(data.issues.map((i) => i.reason)).toEqual([
      'access-denied',
      'conditional-access',
      'duplicate-source',
      'invalid-id',
    ]);
  });

  it('不根据同名合并不同站点，查询副本不修改原数据', () => {
    const data = extractTransferPoints({
      ways: [],
      nodes: [
        node(1, { highway: 'bus_stop', name: '同名站' }),
        node(2, { highway: 'bus_stop', name: '同名站' }),
      ],
    });
    const queried = getTransferPoints(data);
    expect(queried).toHaveLength(2);
    queried[0]!.position[0] = 0;
    expect(data.points[0]!.position[0]).toBe(114);
  });
});
