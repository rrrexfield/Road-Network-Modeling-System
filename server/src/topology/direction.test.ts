import { describe, expect, it } from 'vitest';
import { resolveRoadDirection } from './index';

describe('resolveRoadDirection', () => {
  it.each(['yes', '1'])('oneway=%s 沿原序列单行', (oneway) => {
    expect(resolveRoadDirection({ highway: 'residential', oneway })).toBe('forward');
  });

  it('oneway=-1 逆原序列单行', () => {
    expect(resolveRoadDirection({ highway: 'residential', oneway: '-1' })).toBe('reverse');
  });

  it.each(['no', '0'])('oneway=%s 允许双向', (oneway) => {
    expect(resolveRoadDirection({ highway: 'residential', oneway })).toBe('both');
  });

  it('普通道路无方向标签时为双向', () => {
    expect(resolveRoadDirection({ highway: 'residential' })).toBe('both');
  });

  it('motorway 无方向标签时默认为正向单行', () => {
    expect(resolveRoadDirection({ highway: 'motorway' })).toBe('forward');
  });

  it('roundabout 无方向标签时默认为正向单行', () => {
    expect(resolveRoadDirection({ highway: 'secondary', junction: 'roundabout' })).toBe('forward');
  });

  it('circular 不自动采用 roundabout 单行规则', () => {
    expect(resolveRoadDirection({ highway: 'secondary', junction: 'circular' })).toBe('both');
  });

  it.each<Record<string, string>>([
    { highway: 'motorway' },
    { highway: 'secondary', junction: 'roundabout' },
  ])('显式双向和反向覆盖隐含正向：%j', (tags) => {
    expect(resolveRoadDirection({ ...tags, oneway: 'no' })).toBe('both');
    expect(resolveRoadDirection({ ...tags, oneway: '-1' })).toBe('reverse');
  });

  it.each(['reversible', 'alternating', 'unknown', '', 'true', 'false'])(
    '未支持值 %s 不猜测方向',
    (oneway) => {
      expect(resolveRoadDirection({ highway: 'motorway', oneway })).toBe('unsupported');
    },
  );

  it('条件方向即使附带基础方向也需另行处理', () => {
    expect(
      resolveRoadDirection({
        highway: 'residential',
        oneway: 'yes',
        'oneway:conditional': 'no @ (Mo-Fr 08:00-10:00)',
      }),
    ).toBe('unsupported');
  });

  it('motorway_link 无方向标签时等待默认策略确认', () => {
    expect(resolveRoadDirection({ highway: 'motorway_link' })).toBe('unsupported');
    expect(resolveRoadDirection({ highway: 'motorway_link', oneway: 'yes' })).toBe('forward');
    expect(resolveRoadDirection({ highway: 'motorway_link', oneway: 'no' })).toBe('both');
  });

  it('不修改输入，且不将步行例外作为全道路方向', () => {
    const tags = Object.freeze({ highway: 'residential', oneway: 'yes', 'oneway:foot': 'no' });
    expect(resolveRoadDirection(tags)).toBe('forward');
    expect(tags).toEqual({ highway: 'residential', oneway: 'yes', 'oneway:foot': 'no' });
  });
});
