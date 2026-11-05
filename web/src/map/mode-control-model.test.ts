import { describe, expect, it } from 'vitest';
import { TRAVEL_MODE_OPTIONS, travelModeLabel } from './mode-control-model.js';

describe('交通模式控制模型', () => {
  it('按固定顺序提供全量和四种交通模式', () => {
    expect(TRAVEL_MODE_OPTIONS.map((option) => option.mode)).toEqual([
      'all',
      'car',
      'walk',
      'bike',
      'bus',
    ]);
  });

  it('返回对应的中文名称', () => {
    expect(TRAVEL_MODE_OPTIONS.map((option) => travelModeLabel(option.mode))).toEqual([
      '全量',
      '汽车',
      '步行',
      '骑行',
      '公交',
    ]);
  });
});
