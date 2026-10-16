/**
 * 统计与权重面板的独立预览页(D 交付预览)。
 *
 * 开发服务器下访问 `/src/panels/stats/demo.html`;也可由打包脚本产出单文件 HTML 离线查看。
 * 优先读取实时接口 /api/stats;服务端尚未注册 weights 插件时自动降级到离线示例数据,
 * 页头会明确标注当前数据来源,不以示例数据冒充实时结果。
 */
import type { NetworkStats, WeightProfile } from '../../charts/index.js';
import { createWeightPanel } from '../weight/weight-panel.js';
import { fetchStats, fetchWeightProfile } from './api.js';
import { SAMPLE_STATS } from './sample.js';
import { createStatsPanel } from './stats-panel.js';
import './demo.css';

function must<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`缺少元素 ${selector}`);
  return found;
}

const statsSlot = must<HTMLDivElement>('#slot-stats');
const weightSlot = must<HTMLDivElement>('#slot-weight');
const sourceBadge = must<HTMLSpanElement>('#demo-source');
const topologyButton = must<HTMLButtonElement>('#demo-topology');

const statsPanel = createStatsPanel();
const weightPanel = createWeightPanel({ onChange: (profile) => void reload(profile) });
statsSlot.append(statsPanel.element);
weightSlot.append(weightPanel.element);

let speedTable: Record<string, number> | undefined;
let latest: NetworkStats | null = null;
let latestIsLive = false;
let placeholderMode = false;
let requestToken = 0;

/** 按当前模式重绘统计面板:占位模式下强制展示"拓扑指标待接入"的分支。 */
function paintStats(): void {
  if (latest === null) return;
  const view: NetworkStats =
    placeholderMode && latest.topology !== null
      ? { ...latest, topology: null, topologySource: 'pending' }
      : latest;
  statsPanel.render(view);
  statsPanel.setSource(latestIsLive ? '实时接口' : '离线示例', latestIsLive);
}

function apply(stats: NetworkStats, live: boolean): void {
  latest = stats;
  latestIsLive = live;
  weightPanel.update(stats, speedTable);
  paintStats();
  sourceBadge.textContent = live
    ? '数据来源：/api/stats 实时'
    : '数据来源：离线示例(合成路网,非真实统计)';
  sourceBadge.className = `gis-badge ${live ? 'gis-badge--ok' : 'gis-badge--wait'}`;
  topologyButton.disabled = !live && latest.topology === null;
}

/** 按(可选的)权重配置重新取数;接口不可用时降级到示例数据。 */
async function reload(profile?: WeightProfile): Promise<void> {
  const token = ++requestToken;
  const live = await fetchStats(
    profile === undefined
      ? undefined
      : {
          metric: profile.metric,
          speedFactor: profile.speedFactor,
          speedOverridesKmh: profile.speedOverridesKmh,
        },
  );
  if (token !== requestToken) return; // 丢弃过期响应,避免抖动时旧结果覆盖新结果
  apply(live ?? SAMPLE_STATS, live !== null);
}

topologyButton.addEventListener('click', () => {
  placeholderMode = !placeholderMode;
  topologyButton.textContent = placeholderMode ? '切回已接入态' : '切换拓扑占位态';
  paintStats();
});

async function main(): Promise<void> {
  const profileResponse = await fetchWeightProfile();
  speedTable = profileResponse?.speedTable;
  await reload();
}

void main().catch((error: unknown) => {
  console.error(error);
  sourceBadge.textContent = '初始化失败,详见控制台';
  sourceBadge.className = 'gis-badge gis-badge--bad';
});
