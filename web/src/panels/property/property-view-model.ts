/**
 * 道路属性 → 视图模型。
 *
 * 刻意与 DOM 解耦：本文件是纯函数，可在 Node 环境直接单测，
 * 不需要 jsdom。渲染层只负责把这里的结果贴到 DOM 上。
 */
import type { RoadFeature } from '@gisalgo/shared';

/** 一条「字段名 → 字段值」的展示项。 */
export interface PropertyField {
  label: string;
  value: string;
}

/** 属性面板所需的全部展示数据。 */
export interface PropertyViewModel {
  /** 道路名；缺失时回落为「未命名道路」。 */
  name: string;
  /** 原始 highway 值，用作等级徽标。 */
  highway: string;
  /** Way ID（字符串形式，便于直接写入 DOM）。 */
  wayId: string;
  /** 固定字段：Way ID / 类型。 */
  fields: PropertyField[];
  /** 除 highway / name 之外的全部标签，不截断。 */
  tags: PropertyField[];
  hasTags: boolean;
}

/** 把 GeoJSON 道路要素转换成属性面板的视图模型。 */
export function toPropertyViewModel(feature: RoadFeature): PropertyViewModel {
  const p = feature.properties;
  const trimmedName = (p.name ?? '').trim();

  const tags = Object.entries(p.tags)
    .filter(([key]) => key !== 'highway' && key !== 'name')
    .map(([key, value]) => ({ label: key, value }));

  const wayId = String(p.id);

  return {
    name: trimmedName === '' ? '未命名道路' : trimmedName,
    highway: p.highway,
    wayId,
    fields: [
      { label: 'Way ID', value: wayId },
      { label: '类型', value: p.highway },
    ],
    tags,
    hasTags: tags.length > 0,
  };
}