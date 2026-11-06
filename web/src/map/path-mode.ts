/**
 * 路径请求的模态口径：把界面上的显示模态映射为服务端 `/api/path` 的 mode 参数。
 *
 * 单独抽成纯函数是为了能脱离 DOM 单测这条映射——它是「禁转端到端影响路径」的前端半边：
 * 只有当前模态与编辑禁转时所用的模态一致，服务端才会用同一份禁转表判定转向。
 */
import type { TravelMode } from '@gisalgo/shared';
import type { DisplayMode } from './mode-control-model.js';

/**
 * 解析路径请求应下发的交通模态。
 *
 * - `'all'`（全量基础路网）→ `undefined`：不下发 mode，服务端走基础图、不施加转向限制，
 *   与作业一的行为一致。
 * - 具体模态（car / walk / bike / bus）→ 该模态：服务端走该模态子图，
 *   并按该模态的禁转表判定转向。
 */
export function resolvePathMode(displayMode: DisplayMode | null | undefined): TravelMode | undefined {
  if (displayMode === null || displayMode === undefined || displayMode === 'all') return undefined;
  return displayMode;
}
