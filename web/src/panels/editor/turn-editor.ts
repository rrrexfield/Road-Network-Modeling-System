import type { IntersectionTurns, NearestIntersectionResponse, TravelMode } from '@gisalgo/shared';
import { fetchIntersectionTurns, fetchNearestIntersection, setIntersectionTurns } from '../../api-client.js';
import { travelModeLabel, type DisplayMode } from '../../map/mode-control-model.js';
import {
  forbiddenPairs,
  PICK_MAX_DISTANCE_M,
  PICK_MIN_ZOOM,
  summarizeIntersection,
  turnDescription,
  turnKindLabel,
  turnPairKey,
  type MapLibreLike,
} from './turn-editor-model.js';
import './turn-editor.css';

const SAMPLE_NODE_ID = 1881981626;

/** 全量模式没有按模态划分的转向表，点击地图无法确定该用哪张表。 */
const ALL_MODE_PICK_HINT = '全量模式没有统一的转向表，请先选择具体交通模式';

export interface TurnEditorHandle {
  element: HTMLElement;
  setMode(mode: DisplayMode | null): void;
  dispose(): void;
}

export interface TurnEditorOptions {
  getMode: () => DisplayMode | null;
  getRoadName: (wayId: number) => string;
  onIntersectionFocus: (intersection: IntersectionTurns) => void;
  onRestrictionChange: (intersection: IntersectionTurns | null) => void;
  /**
   * 禁转**已成功落盘**后回调（保存失败时触发）。
   *
   * 与 `onRestrictionChange` 区分开：后者在勾选预览、加载、清空等每次变动时都会触发，
   * 此时禁转尚未写入服务端，路径还不会绕行；只有本回调表示服务端禁转表已更新，
   * 此时重算路径才能得到真正绕开禁转的结果。
   */
  onRestrictionsSaved?: (intersection: IntersectionTurns) => void;
  /**
   * 地图事件源。传入后，转向限制栏展开时点击地图可拾取最近的路口。
   *
   * 收起时不注册任何地图监听，点击地图仍是宿主的原有行为。
   */
  map?: MapLibreLike;
  /** 拾取命中路口后通知宿主（宿主用于聚焦地图 / 打标记）。 */
  onIntersectionSelected?: (info: NearestIntersectionResponse) => void;
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

export function createTurnEditor(options: TurnEditorOptions): TurnEditorHandle {
  const root = element('section', 'turn-editor is-collapsed');
  const head = element('button', 'turn-editor__head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  const title = element('span', 'turn-editor__title', '路口转向限制');
  const modeBadge = element('span', 'turn-editor__mode', '未选择模式');
  const chevron = element('span', 'turn-editor__chevron', '▸');
  head.append(title, modeBadge, chevron);

  const body = element('div', 'turn-editor__body');
  const meta = element('div', 'turn-editor__meta is-empty');
  const metaTitle = element('span', 'turn-editor__meta-title', '路口属性');
  const metaRows = element('div', 'turn-editor__meta-rows');
  meta.append(metaTitle, metaRows);
  const controls = element('div', 'turn-editor__controls');
  const nodeInput = element('input', 'turn-editor__node');
  nodeInput.type = 'number';
  nodeInput.inputMode = 'numeric';
  nodeInput.value = String(SAMPLE_NODE_ID);
  nodeInput.placeholder = '路口 Node ID';
  const sampleButton = element('button', 'turn-editor__button', '五路口示例');
  sampleButton.type = 'button';
  const loadButton = element('button', 'turn-editor__button is-primary', '加载路口');
  loadButton.type = 'button';
  controls.append(nodeInput, sampleButton, loadButton);

  const status = element('p', 'turn-editor__status', '请选择交通模式后加载路口');
  const list = element('div', 'turn-editor__list');
  const footer = element('div', 'turn-editor__footer');
  const summary = element('span', 'turn-editor__summary', '尚未加载');
  const actions = element('div', 'turn-editor__actions');
  const clearButton = element('button', 'turn-editor__button', '清空选择');
  clearButton.type = 'button';
  clearButton.title = '取消当前路口的全部勾选，保存后生效';
  clearButton.disabled = true;
  const saveButton = element('button', 'turn-editor__button is-save', '保存禁转');
  saveButton.type = 'button';
  saveButton.disabled = true;
  actions.append(clearButton, saveButton);
  footer.append(summary, actions);
  body.append(meta, controls, status, list, footer);
  root.append(head, body);

  let mode: DisplayMode | null | undefined;
  let current: IntersectionTurns | null = null;
  let baseline = new Set<string>();
  let pending = new Set<string>();
  let checkboxes = new Map<string, HTMLInputElement>();
  let busy = false;
  let picking = false;
  let collapsed = true;
  let mapListenerAttached = false;

  /**
   * 地图点击回调：注册与移除必须使用同一个函数引用。
   */
  const mapClickHandler = (event: { lngLat: { lng: number; lat: number } }): void => {
    void pickIntersection(event.lngLat.lng, event.lngLat.lat);
  };

  function activeMode(): TravelMode | null {
    return mode !== null && mode !== undefined && mode !== 'all' ? mode : null;
  }

  /**
   * 同步地图 click 监听：仅在面板展开时注册，收起时移除。
   */
  function syncMapListener(): void {
    const map = options.map;
    if (map === undefined) return;
    if (collapsed) {
      if (mapListenerAttached) {
        map.off('click', mapClickHandler);
        mapListenerAttached = false;
      }
      return;
    }
    if (!mapListenerAttached) {
      map.on('click', mapClickHandler);
      mapListenerAttached = true;
    }
  }

  function setCollapsed(next: boolean): void {
    collapsed = next;
    root.classList.toggle('is-collapsed', next);
    head.setAttribute('aria-expanded', String(!next));
    chevron.textContent = next ? '▸' : '▾';
    syncMapListener();
  }

  function setStatus(text: string, state?: 'ok' | 'pending' | 'error'): void {
    status.textContent = text;
    if (state === undefined) delete status.dataset.state;
    else status.dataset.state = state;
  }

  function clearMeta(): void {
    metaRows.replaceChildren();
    meta.classList.add('is-empty');
  }

  function renderMeta(info: NearestIntersectionResponse): void {
    metaRows.replaceChildren();
    for (const field of summarizeIntersection(info)) {
      const row = element('div', 'turn-editor__meta-row');
      row.append(
        element('span', 'turn-editor__meta-label', field.label),
        element('span', 'turn-editor__meta-value', field.value),
      );
      metaRows.append(row);
    }
    meta.classList.remove('is-empty');
  }

  function clearData(message = '请选择交通模式后加载路口'): void {
    current = null;
    baseline = new Set();
    pending = new Set();
    checkboxes = new Map();
    list.replaceChildren();
    clearMeta();
    summary.textContent = '尚未加载';
    clearButton.disabled = true;
    saveButton.disabled = true;
    setStatus(message);
    options.onRestrictionChange(null);
  }

  function syncDirty(): void {
    const dirty =
      current !== null &&
      !(pending.size === baseline.size && [...pending].every((key) => baseline.has(key)));
    saveButton.disabled = activeMode() === null || busy || current === null || !dirty;
    clearButton.disabled = activeMode() === null || busy || current === null || pending.size === 0;
    summary.textContent =
      current === null ? '尚未加载' : `${pending.size} 条禁转${dirty ? '（未保存）' : ''}`;
  }

  function restrictionPreview(): IntersectionTurns | null {
    if (current === null) return null;
    return {
      ...current,
      turns: current.turns.map((turn) => ({
        ...turn,
        forbidden: pending.has(turnPairKey(turn)),
      })),
    };
  }

  function renderTurns(data: IntersectionTurns): void {
    list.replaceChildren();
    checkboxes = new Map();
    for (const turn of data.turns) {
      const key = turnPairKey(turn);
      const row = element('label', 'turn-editor__row');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'turn-editor__check';
      checkbox.checked = turn.forbidden;
      checkboxes.set(key, checkbox);

      const text = element('span', 'turn-editor__copy');
      text.append(
        element('strong', 'turn-editor__kind', turnKindLabel(turn.turnKind)),
        element('span', 'turn-editor__route', turnDescription(turn, options.getRoadName)),
      );
      const source = element(
        'span',
        `turn-editor__source${turn.fromOsm ? ' is-osm' : ''}`,
        turn.fromOsm ? 'OSM' : '手动',
      );
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) pending.add(key);
        else pending.delete(key);
        row.classList.toggle('is-forbidden', checkbox.checked);
        options.onRestrictionChange(restrictionPreview());
        syncDirty();
      });
      row.classList.toggle('is-forbidden', checkbox.checked);
      row.append(checkbox, text, source);
      list.append(row);
    }
  }

  async function load(nodeId: number): Promise<void> {
    const requestMode = activeMode();
    if (requestMode === null) {
      setStatus('“全量”模式没有统一的转向表，请先选择具体交通模式', 'error');
      return;
    }
    if (!Number.isSafeInteger(nodeId) || nodeId <= 0) {
      setStatus('请输入有效的路口 Node ID', 'error');
      return;
    }

    busy = true;
    loadButton.disabled = true;
    sampleButton.disabled = true;
    setStatus(`正在加载路口 ${nodeId}…`, 'pending');
    try {
      const data = await fetchIntersectionTurns(nodeId, requestMode);
      current = data;
      baseline = new Set(forbiddenPairs(data.turns).map(turnPairKey));
      pending = new Set(baseline);
      renderTurns(data);
      summary.textContent = `${data.turns.length} 个转向 · ${pending.size} 条禁转`;
      setStatus(`已加载路口 ${data.nodeId}`, 'ok');
      options.onIntersectionFocus(data);
      options.onRestrictionChange(data);
    } catch (error) {
      clearData(error instanceof Error ? error.message : '路口加载失败');
      status.dataset.state = 'error';
    } finally {
      busy = false;
      loadButton.disabled = activeMode() === null;
      sampleButton.disabled = activeMode() === null;
      syncDirty();
    }
  }

  async function save(): Promise<void> {
    const requestMode = activeMode();
    if (requestMode === null || current === null || busy) return;
    busy = true;
    saveButton.disabled = true;
    loadButton.disabled = true;
    setStatus('正在保存整个路口的禁转集合…', 'pending');
    const result = await setIntersectionTurns(
      current.nodeId,
      forbiddenPairs(
        current.turns.map((turn) => ({
          ...turn,
          forbidden: pending.has(turnPairKey(turn)),
        })),
      ),
      requestMode,
    );
    busy = false;
    loadButton.disabled = activeMode() === null;
    if (!result.ok) {
      options.onRestrictionChange(current);
      setStatus(
        result.reason === 'restore-mismatch'
          ? `禁转快照失配，禁止覆盖：${result.message}`
          : result.message,
        'error',
      );
      syncDirty();
      return;
    }

    const updated = restrictionPreview();
    if (updated === null) return;
    current = updated;
    baseline = new Set(pending);
    options.onRestrictionChange(updated);
    // 服务端禁转表已更新：通知宿主重算当前路径，使禁转真正反映到路径结果上。
    options.onRestrictionsSaved?.(updated);
    summary.textContent = `${updated.turns.length} 个转向 · ${pending.size} 条禁转`;
    setStatus(`已保存 ${result.restrictionCount} 条禁转`, 'ok');
    syncDirty();
  }

  /**
   * 拾取点击位置附近的可编辑路口(issue #43)。
   *
   * 口径:只在**当前模态**下查询(全量模式没有统一的转向表,直接提示),
   * 命中半径 15 米,缩放级别低于 15 不发起查询(避免误选远处路口)。
   * 命中则自动填充 Node ID、加载该路口的全部转向并展示最小路口属性;
   * 未命中只提示,**不伪造 Node ID**,也不动当前已加载的路口。
   */
  async function pickIntersection(lon: number, lat: number): Promise<void> {
    const requestMode = activeMode();
    if (requestMode === null) {
      setStatus(ALL_MODE_PICK_HINT, 'error');
      return;
    }
    const map = options.map;
    if (map !== undefined && map.getZoom() < PICK_MIN_ZOOM) {
      setStatus(`请放大到 ${PICK_MIN_ZOOM} 级以上再选择路口`, 'error');
      return;
    }
    if (picking) return;
    picking = true;
    setStatus('正在查找附近的路口…', 'pending');
    try {
      const found = await fetchNearestIntersection(lon, lat, requestMode, PICK_MAX_DISTANCE_M);
      if (found === null) {
        // 阈值内没有可编辑路口是正常结果(点到了普通道路),不是接口故障。
        setStatus('附近没有可编辑路口，请放大后重试', 'error');
        return;
      }
      renderMeta(found);
      nodeInput.value = String(found.nodeId);
      options.onIntersectionSelected?.(found);
      await load(found.nodeId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '查询附近路口失败', 'error');
    } finally {
      picking = false;
    }
  }

  function setMode(nextMode: DisplayMode | null): void {
    if (mode === nextMode) return;
    // 构造时的首次赋值不是"切换",此时保留输入框里的五路口样例;
    // 真正的模态切换要清空已选路口——否则会用旧模态的 nodeId 去查新模态的路口。
    const isSwitch = mode !== undefined;
    mode = nextMode;
    const available = activeMode() !== null;
    modeBadge.textContent = mode === null || mode === 'all' ? '全量模式' : travelModeLabel(mode);
    nodeInput.disabled = !available;
    loadButton.disabled = !available;
    sampleButton.disabled = !available;
    if (isSwitch) nodeInput.value = '';
    clearData(available ? '输入路口 Node ID 后加载' : '请选择汽车、步行、骑行或公交模式');
  }

  head.addEventListener('click', () => {
    setCollapsed(!root.classList.contains('is-collapsed'));
  });
  sampleButton.addEventListener('click', () => {
    nodeInput.value = String(SAMPLE_NODE_ID);
    void load(SAMPLE_NODE_ID);
  });
  loadButton.addEventListener('click', () => void load(Number(nodeInput.value)));
  nodeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void load(Number(nodeInput.value));
  });
  clearButton.addEventListener('click', () => {
    if (current === null || busy) return;
    pending.clear();
    for (const [key, checkbox] of checkboxes) {
      checkbox.checked = false;
      checkbox.closest('.turn-editor__row')?.classList.remove('is-forbidden');
      pending.delete(key);
    }
    options.onRestrictionChange(restrictionPreview());
    syncDirty();
  });
  saveButton.addEventListener('click', () => void save());

  setMode(options.getMode());
  return {
    element: root,
    setMode,
    dispose: () => {
      // 移除地图监听:面板销毁后不应再响应地图点击。
      if (mapListenerAttached && options.map !== undefined) {
        options.map.off('click', mapClickHandler);
        mapListenerAttached = false;
      }
      root.remove();
      options.onRestrictionChange(null);
    },
  };
}
