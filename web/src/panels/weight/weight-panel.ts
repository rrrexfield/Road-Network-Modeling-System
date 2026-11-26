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
  /**
   * 配置变化回调;拖动滑杆时按 debounceMs 去抖后触发。
   * 第二参数为时段模拟(Sprint 3)状态:hourEnabled=false 时省略,调用方按"无交通条件"处理。
   */
  onChange?: (profile: WeightProfile, traffic?: WeightPanelTraffic) => void;
  /** 去抖毫秒数,默认 240。 */
  debounceMs?: number;
}

/** 时段模拟(拥堵时间槽 + 事件场景)的面板状态。 */
export interface WeightPanelTraffic {
  /** 是否启用时段模拟;false 时其余字段无意义。 */
  hourEnabled: boolean;
  /** 参考钟点(0–24,0.5 步进 = 30 分钟槽)。 */
  hourOfDay: number;
  /** 拥堵时间槽是否启用。 */
  congestionEnabled: boolean;
  /** 事件场景是否启用。 */
  eventsEnabled: boolean;
}

/** 面板句柄。 */
export interface WeightPanelHandle {
  element: HTMLElement;
  /** 用最新统计与(可选的)默认限速表刷新面板。 */
  update(stats: NetworkStats, speedTable?: Readonly<Record<string, number>>): void;
  /** 读取当前配置。 */
  getProfile(): WeightProfile;
  /** 读取时段模拟状态。 */
  getTraffic(): WeightPanelTraffic;
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

  // 面板只管**全局权重配置**(速度系数与等级限速覆盖)。
  // 「最快时间 / 最短距离」这一优化目标由起终点选路卡负责(issue #45 的职责划分),
  // 此处不再重复提供,避免两个入口改同一个值导致状态不一致。
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
    '系数 >1 表示整体提速(通行时间同比缩短)。该系数只作用于**用时最短**口径,' +
      '优化目标由起终点选路卡选择;选"最短距离"时本面板的参数不参与路径计算。',
  );
  root.append(factorGroup, factorHint);

  // ---- 时段模拟(Sprint 3 · issue #65):拥堵时间槽 + 事件场景 ----
  const trafficState: WeightPanelTraffic = {
    hourEnabled: false,
    hourOfDay: 8.5,
    congestionEnabled: true,
    eventsEnabled: true,
  };
  const trafficGroup = element('div', 'gis-field gis-traffic');
  const trafficCheck = document.createElement('input');
  trafficCheck.type = 'checkbox';
  trafficCheck.className = 'gis-check';
  trafficCheck.id = 'gis-traffic-toggle';
  const trafficLabel = element(
    'label',
    'gis-field__label gis-traffic__label',
    '时段模拟(拥堵时间槽)',
  );
  trafficLabel.htmlFor = trafficCheck.id;
  const trafficValue = element('span', 'gis-field__value', '08:30 · 平峰');
  trafficCheck.addEventListener('change', () => {
    trafficState.hourEnabled = trafficCheck.checked;
    hourInput.disabled = !trafficCheck.checked;
    congestionCheck.disabled = !trafficCheck.checked;
    eventsCheck.disabled = !trafficCheck.checked;
    syncControls();
    scheduleEmit();
  });
  const hourInput = document.createElement('input');
  hourInput.type = 'range';
  hourInput.className = 'gis-range';
  hourInput.min = '0';
  hourInput.max = '24';
  hourInput.step = '0.5';
  hourInput.value = String(trafficState.hourOfDay);
  hourInput.disabled = true;
  hourInput.addEventListener('input', () => {
    trafficState.hourOfDay = Number(hourInput.value);
    syncControls();
    scheduleEmit();
  });
  trafficGroup.append(trafficCheck, trafficLabel, trafficValue, hourInput);

  const congestionCheck = document.createElement('input');
  congestionCheck.type = 'checkbox';
  congestionCheck.className = 'gis-check';
  congestionCheck.id = 'gis-congestion-toggle';
  congestionCheck.checked = true;
  congestionCheck.disabled = true;
  const congestionLabel = element('label', 'gis-note gis-traffic__sub', '拥堵时间槽(早晚高峰)');
  congestionLabel.htmlFor = congestionCheck.id;
  congestionCheck.addEventListener('change', () => {
    trafficState.congestionEnabled = congestionCheck.checked;
    scheduleEmit();
  });

  const eventsCheck = document.createElement('input');
  eventsCheck.type = 'checkbox';
  eventsCheck.className = 'gis-check';
  eventsCheck.id = 'gis-events-toggle';
  eventsCheck.checked = true;
  eventsCheck.disabled = true;
  const eventsLabel = element('label', 'gis-note gis-traffic__sub', '事件场景(封闭/事故降速)');
  eventsLabel.htmlFor = eventsCheck.id;
  eventsCheck.addEventListener('change', () => {
    trafficState.eventsEnabled = eventsCheck.checked;
    scheduleEmit();
  });

  trafficGroup.append(congestionCheck, congestionLabel, eventsCheck, eventsLabel);
  const trafficHint = element(
    'p',
    'gis-note',
    '确定性模拟:同一钟点重复计算结果逐位相同(服务端按 30 分钟槽取拥堵曲线,' +
      '封闭路段按不可通行处理)。合成顺序:基础限速 × 全局系数 ÷ 拥堵系数 × 事件乘子。',
  );
  root.append(trafficGroup, trafficHint);

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
  /** 钟点 → HH:MM 文案;30 分钟步进下分钟只可能是 00/30。 */
  function formatHour(hour: number): string {
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** 时段描述:按默认曲线粗分,用于滑杆旁的即时提示(权威值由服务端重算)。 */
  function slotLabel(hour: number): string {
    if (hour >= 7 && hour < 9.5) return '早高峰';
    if (hour >= 17 && hour < 19.5) return '晚高峰';
    if (hour < 5.5 || hour >= 23) return '夜间畅通';
    return '平峰';
  }

  function syncControls(): void {
    trafficValue.textContent = trafficState.hourEnabled
      ? `${formatHour(trafficState.hourOfDay)} · ${slotLabel(trafficState.hourOfDay)}`
      : '未启用';
    summaryBadge.textContent = `×${profile.speedFactor.toFixed(2)}`;
    summaryBadge.className = 'gis-badge gis-badge--ok';
    factorValue.textContent = `×${profile.speedFactor.toFixed(2)}`;

    let total = 0;
    for (const entry of highwayRows) {
      const base = baseSpeed.get(entry.highway) ?? 0;
      const override = profile.speedOverridesKmh[entry.highway];
      if (document.activeElement !== entry.speedInput) {
        entry.speedInput.value = String(Math.round(override ?? base));
      }
      const seconds = secondsFor(entry.lengthMeters, effectiveSpeed(entry.highway));
      entry.timeCell.textContent = Number.isFinite(seconds) ? formatDuration(seconds) : '—';
      entry.row.classList.toggle('gis-table__row--overridden', override !== undefined);
      if (Number.isFinite(seconds)) total += seconds;
    }
    totalValue.textContent = formatDuration(total);
  }

  function emit(): void {
    syncControls();
    options.onChange?.(profile, trafficState.hourEnabled ? { ...trafficState } : undefined);
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
    getTraffic: () => ({ ...trafficState }),
    dispose: () => {
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    },
  };
}
