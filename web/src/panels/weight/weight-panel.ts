/**
 * 权重配置面板:选择优化目标、调整全局速度系数与各等级限速,并即时给出通行时间预估。
 *
 * 面板只负责产出 WeightProfile 并回显效果,不做路径计算:
 * 权威值由服务端 `GET /api/stats` 在收到同一配置后重算(见 api.ts)。
 * 面板内的"预计通行时间"是按已收到的等级里程做的即时预估,便于滑杆拖动时无需等待网络;
 * 它与服务端 createTimeWeight 使用同一换算关系(里程 / 有效限速),公式口径见 server/src/weights。
 */
import {
  formatDuration,
  formatKilometers,
  formatPercent,
  type HighwayStat,
  type NetworkStats,
  type WeightProfile,
} from '../../charts/index.js';
import './weight-panel.css';

/** 面板选项。 */
export interface WeightPanelOptions {
  /** 配置变化回调;拖动滑杆时按 debounceMs 去抖后触发。 */
  onChange?: (profile: WeightProfile) => void;
  /** 去抖毫秒数,默认 240。 */
  debounceMs?: number;
}

/** 面板句柄。 */
export interface WeightPanelHandle {
  element: HTMLElement;
  /** 用最新统计与(可选的)默认限速表刷新面板。 */
  update(stats: NetworkStats, speedTable?: Readonly<Record<string, number>>): void;
  /** 读取当前配置。 */
  getProfile(): WeightProfile;
  dispose(): void;
}

/** 速度系数滑杆范围。 */
const FACTOR_MIN = 0.5;
const FACTOR_MAX = 2;
const FACTOR_STEP = 0.05;

interface HighwayRow {
  row: HTMLElement;
  speedInput: HTMLInputElement;
  timeCell: HTMLElement;
  highway: string;
  lengthMeters: number;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 创建权重配置面板。
 * @param options 变化回调与去抖配置。
 * @returns 面板句柄;调用 update 之前不显示任何数值。
 */
export function createWeightPanel(options: WeightPanelOptions = {}): WeightPanelHandle {
  const debounceMs = options.debounceMs ?? 240;

  /** 等级默认限速:优先取 /api/weights/profile 的 speedTable,缺失时退回统计里的平均速度。 */
  const baseSpeed = new Map<string, number>();
  let hasServerSpeedTable = false;

  let profile: WeightProfile = { metric: 'time', speedFactor: 1, speedOverridesKmh: {} };
  let highwayRows: HighwayRow[] = [];
  let totalLengthMeters = 0;
  let lengthByHighway = new Map<string, number>();
  let debounceTimer: number | undefined;

  const root = element('section', 'gis-panel gis-weight');

  const head = element('header', 'gis-panel__head');
  head.append(element('h2', 'gis-panel__title', '权重配置'));
  const summaryBadge = element('span', 'gis-badge gis-badge--wait', '尚未加载');
  head.append(summaryBadge);
  root.append(head);

  // ---- 优化目标 ----
  const metricGroup = element('div', 'gis-field');
  metricGroup.append(element('span', 'gis-field__label', '优化目标'));
  const metricToggle = element('div', 'gis-segmented');
  const metricButtons = new Map<WeightProfile['metric'], HTMLButtonElement>();
  for (const [value, label] of [
    ['time', '最快时间'],
    ['distance', '最短距离'],
  ] as [WeightProfile['metric'], string][]) {
    const button = element('button', 'gis-segmented__item', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      profile = { ...profile, metric: value };
      syncControls();
      scheduleEmit();
    });
    metricButtons.set(value, button);
    metricToggle.append(button);
  }
  metricGroup.append(metricToggle);
  root.append(metricGroup);

  // ---- 全局速度系数 ----
  const factorGroup = element('div', 'gis-field');
  factorGroup.append(element('span', 'gis-field__label', '全局速度系数'));
  const factorInput = document.createElement('input');
  factorInput.type = 'range';
  factorInput.className = 'gis-range';
  factorInput.min = String(FACTOR_MIN);
  factorInput.max = String(FACTOR_MAX);
  factorInput.step = String(FACTOR_STEP);
  factorInput.value = String(profile.speedFactor);
  const factorValue = element('span', 'gis-field__value', '×1.00');
  factorInput.addEventListener('input', () => {
    profile = { ...profile, speedFactor: Number(factorInput.value) };
    syncControls();
    scheduleEmit();
  });
  factorGroup.append(factorInput, factorValue);
  const factorHint = element(
    'p',
    'gis-note',
    '系数 >1 表示整体提速(通行时间同比缩短);选择"最短距离"时该系数不参与计算。',
  );
  root.append(factorGroup, factorHint);

  // ---- 等级限速与明细 ----
  const tableHead = element('div', 'gis-table__head');
  tableHead.append(
    element('span', 'gis-table__cell gis-table__cell--name', '等级'),
    element('span', 'gis-table__cell gis-table__cell--num', '里程'),
    element('span', 'gis-table__cell gis-table__cell--num', '占比'),
    element('span', 'gis-table__cell gis-table__cell--num', '限速'),
    element('span', 'gis-table__cell gis-table__cell--num', '通行时间'),
  );
  const tableBody = element('div', 'gis-table__body');
  const speedTable = element('div', 'gis-table');
  speedTable.append(tableHead, tableBody);
  root.append(speedTable);

  // ---- 汇总 ----
  const totalRow = element('div', 'gis-weight__total');
  const totalLabel = element('span', 'gis-weight__total-label', '预计总通行时间');
  const totalValue = element('span', 'gis-weight__total-value', '—');
  totalRow.append(totalLabel, totalValue);
  root.append(totalRow);

  const resetButton = element('button', 'gis-button', '重置为默认限速');
  resetButton.type = 'button';
  resetButton.addEventListener('click', () => {
    profile = { metric: profile.metric, speedFactor: 1, speedOverridesKmh: {} };
    factorInput.value = String(profile.speedFactor);
    syncControls();
    emit();
  });
  root.append(resetButton);

  const sourceNote = element('p', 'gis-note gis-note--summary');
  root.append(sourceNote);

  /** 当前等级的有效限速(km/h);覆盖表优先,其次服务端默认表,最后统计平均速度。 */
  function effectiveSpeed(highway: string): number {
    const override = profile.speedOverridesKmh[highway];
    if (override !== undefined) return override * profile.speedFactor;
    return (baseSpeed.get(highway) ?? 0) * profile.speedFactor;
  }

  /** 里程与有效限速换算预估通行时间(秒);有效限速为 0 时视为不可通行。 */
  function secondsFor(lengthMeters: number, speed: number): number {
    if (!(speed > 0)) return Number.POSITIVE_INFINITY;
    return lengthMeters / ((speed * 1000) / 3600);
  }

  function renderRows(): void {
    highwayRows = [];
    tableBody.replaceChildren();
    const rows = [...baseSpeed.keys()].sort(
      (a, b) => (statsLengthOf(b) ?? 0) - (statsLengthOf(a) ?? 0) || a.localeCompare(b),
    );
    for (const highway of rows) {
      const lengthMeters = statsLengthOf(highway) ?? 0;
      const share = totalLengthMeters > 0 ? lengthMeters / totalLengthMeters : 0;

      const row = element('div', 'gis-table__row');
      row.append(element('span', 'gis-table__cell gis-table__cell--name', highway));

      const lengthCell = element(
        'span',
        'gis-table__cell gis-table__cell--num',
        lengthMeters > 0 ? formatKilometers(lengthMeters) : '—',
      );
      row.append(lengthCell);

      row.append(element('span', 'gis-table__cell gis-table__cell--num', formatPercent(share)));

      const speedInput = document.createElement('input');
      speedInput.type = 'number';
      speedInput.className = 'gis-input gis-input--num';
      speedInput.min = '1';
      speedInput.max = '200';
      speedInput.step = '5';
      speedInput.value = String(Math.round(baseSpeed.get(highway) ?? 0));
      speedInput.addEventListener('input', () => {
        const parsed = Number(speedInput.value);
        const overrides = { ...profile.speedOverridesKmh };
        if (Number.isFinite(parsed) && parsed > 0) overrides[highway] = parsed;
        else delete overrides[highway];
        profile = { ...profile, speedOverridesKmh: overrides };
        syncControls();
        scheduleEmit();
      });
      const speedWrap = element('span', 'gis-table__cell gis-table__cell--num');
      speedWrap.append(speedInput);
      row.append(speedWrap);

      const timeCell = element('span', 'gis-table__cell gis-table__cell--num gis-time', '—');
      row.append(timeCell);

      tableBody.append(row);
      highwayRows.push({ row, speedInput, timeCell, highway, lengthMeters });
    }
  }

  /** 某等级的里程(米);未出现在当前统计中返回 undefined。 */
  function statsLengthOf(highway: string): number | undefined {
    return lengthByHighway.get(highway);
  }

  /** 按当前配置刷新全部输入控件与只读展示。 */
  function syncControls(): void {
    for (const [value, button] of metricButtons) {
      button.classList.toggle('gis-segmented__item--active', value === profile.metric);
      button.setAttribute('aria-pressed', String(value === profile.metric));
    }
    summaryBadge.textContent = profile.metric === 'time' ? '按时间' : '按距离';
    summaryBadge.className = 'gis-badge gis-badge--ok';
    factorValue.textContent = `×${profile.speedFactor.toFixed(2)}`;
    const timeMode = profile.metric === 'time';
    factorInput.disabled = !timeMode;
    factorGroup.classList.toggle('gis-field--muted', !timeMode);

    let total = 0;
    for (const entry of highwayRows) {
      const base = baseSpeed.get(entry.highway) ?? 0;
      const override = profile.speedOverridesKmh[entry.highway];
      if (document.activeElement !== entry.speedInput) {
        entry.speedInput.value = String(Math.round(override ?? base));
      }
      entry.speedInput.disabled = !timeMode;
      const seconds = secondsFor(entry.lengthMeters, effectiveSpeed(entry.highway));
      entry.timeCell.textContent = timeMode ? formatDuration(seconds) : '—';
      entry.row.classList.toggle('gis-table__row--overridden', override !== undefined);
      if (timeMode && Number.isFinite(seconds)) total += seconds;
    }
    totalValue.textContent = timeMode ? formatDuration(total) : '按里程最短,不计时间';
  }

  function emit(): void {
    syncControls();
    options.onChange?.(profile);
  }

  function scheduleEmit(): void {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = undefined;
      emit();
    }, debounceMs);
  }

  return {
    element: root,
    update(stats: NetworkStats, speedTable?: Readonly<Record<string, number>>): void {
      totalLengthMeters = stats.totalLengthMeters;
      lengthByHighway = new Map(
        stats.byHighway.map((row: HighwayStat) => [row.highway, row.lengthMeters]),
      );

      if (speedTable !== undefined) hasServerSpeedTable = true;
      // 默认限速优先取服务端的等级速度表;表中缺项(如 unknown)退回统计数据反算:
      // 统计里的平均速度已含全局系数,故先除掉 stats.profile.speedFactor 还原基准限速。
      const statsFactor = stats.profile.speedFactor > 0 ? stats.profile.speedFactor : 1;
      baseSpeed.clear();
      for (const row of stats.byHighway) {
        baseSpeed.set(row.highway, speedTable?.[row.highway] ?? row.averageSpeedKmh / statsFactor);
      }
      renderRows();
      syncControls();

      sourceNote.textContent = hasServerSpeedTable
        ? '基准限速取自服务端 /api/weights/profile;修改后由服务端重算权威值,面板显示为即时预估。'
        : '未取到服务端限速表,基准限速由统计数据反算;修改后由服务端重算权威值,面板显示为即时预估。';
    },
    getProfile: () => profile,
    dispose: () => {
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    },
  };
}
