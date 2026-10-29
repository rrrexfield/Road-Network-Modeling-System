/**
 * web/src/map 公开入口：底图与路网图层。
 * 跨模块只经此入口引用（见 AGENTS.md 目录所有权）。
 */
export * from './basemap';
export * from './roads-layer';
export { createPathSelection } from './path-selection.js';
export type { PathSelectionHandle, PathSelectionOptions } from './path-selection.js';