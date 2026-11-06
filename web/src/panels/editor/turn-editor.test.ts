// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntersectionTurns, NearestIntersectionResponse } from '@gisalgo/shared';
import { createTurnEditor, type TurnEditorHandle } from './turn-editor.js';

const fetchNearestIntersection = vi.fn();
const fetchIntersectionTurns = vi.fn();
const setIntersectionTurns = vi.fn();

vi.mock('../../api-client.js', () => ({
  fetchNearestIntersection: (...args: unknown[]) => fetchNearestIntersection(...args),
  fetchIntersectionTurns: (...args: unknown[]) => fetchIntersectionTurns(...args),
  setIntersectionTurns: (...args: unknown[]) => setIntersectionTurns(...args),
}));

/** 最小假的地图事件源：记录注册与移除的 click 监听。 */
type ClickHandler = (event: { lngLat: { lng: number; lat: number } }) => void;

interface FakeMap {
  on: (event: 'click', cb: ClickHandler) => void;
  off: (event: 'click', cb: ClickHandler) => void;
  getZoom: () => number;
  /** 触发一次地图点击。 */
  click(lng: number, lat: number): void;
  /** 当前注册的 click 监听数。 */
  listenerCount(): number;
}

function fakeMap(zoom = 17): FakeMap {
  const handlers = new Set<ClickHandler>();
  return {
    on: vi.fn((_event: 'click', cb: ClickHandler) => {
      handlers.add(cb);
    }),
    off: vi.fn((_event: 'click', cb: ClickHandler) => {
      handlers.delete(cb);
    }),
    getZoom: () => zoom,
    click(lng: number, lat: number): void {
      for (const handler of [...handlers]) handler({ lngLat: { lng, lat } });
    },
    listenerCount: () => handlers.size,
  };
}

const INTERSECTION: NearestIntersectionResponse = {
  nodeId: 1881981626,
  position: [114.3, 30.5],
  distanceMeters: 4.2,
  degree: 5,
  connectedWayIds: [100, 200, 300],
  roadNames: ['胜利街', '一元路'],
};

function turns(nodeId = INTERSECTION.nodeId): IntersectionTurns {
  return {
    nodeId,
    position: [114.3, 30.5],
    turns: [
      {
        fromEdge: 1,
        toEdge: 2,
        fromWayId: 100,
        toWayId: 200,
        turnKind: 'left',
        angleDelta: -80,
        forbidden: false,
        fromOsm: false,
      },
    ],
  };
}

function setup(options: { zoom?: number } = {}): {
  editor: TurnEditorHandle;
  map: FakeMap;
  head: HTMLButtonElement;
  status: () => string;
  nodeInput: () => HTMLInputElement;
} {
  const map = fakeMap(options.zoom ?? 17);
  const selected: NearestIntersectionResponse[] = [];
  const editor = createTurnEditor({
    getMode: () => 'car',
    getRoadName: (wayId) => `Way ${wayId}`,
    map,
    onIntersectionSelected: (info) => selected.push(info),
    onIntersectionFocus: () => undefined,
    onRestrictionChange: () => undefined,
  });
  document.body.append(editor.element);
  const head = editor.element.querySelector('.turn-editor__head') as HTMLButtonElement;
  return {
    editor,
    map,
    head,
    status: () => editor.element.querySelector('.turn-editor__status')?.textContent ?? '',
    nodeInput: () => editor.element.querySelector('.turn-editor__node') as HTMLInputElement,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('转向编辑器的路口拾取', () => {
  it('收起时不注册地图 click 监听（道路属性卡行为不受影响）', () => {
    const { map } = setup();
    expect(map.on).not.toHaveBeenCalled();
    expect(map.listenerCount()).toBe(0);
  });

  it('展开时注册监听，点击后按当前模态查询最近路口并填充 Node ID', async () => {
    fetchNearestIntersection.mockResolvedValue(INTERSECTION);
    fetchIntersectionTurns.mockResolvedValue(turns());
    const { map, head, nodeInput, status } = setup();

    head.click();
    expect(map.listenerCount()).toBe(1);

    map.click(114.3, 30.5);
    await vi.waitFor(() => expect(fetchNearestIntersection).toHaveBeenCalled());
    expect(fetchNearestIntersection).toHaveBeenCalledWith(114.3, 30.5, 'car', 15);

    await vi.waitFor(() => expect(fetchIntersectionTurns).toHaveBeenCalledWith(1881981626, 'car'));
    expect(nodeInput().value).toBe('1881981626');
    expect(status()).toContain('1881981626');
  });

  it('命中后展示最小路口属性（关联道路数、相连 Way、路名）', async () => {
    fetchNearestIntersection.mockResolvedValue(INTERSECTION);
    fetchIntersectionTurns.mockResolvedValue(turns());
    const { map, head } = setup();
    head.click();
    map.click(114.3, 30.5);
    await vi.waitFor(() => expect(fetchIntersectionTurns).toHaveBeenCalled());
    const meta = document.querySelector('.turn-editor__meta') as HTMLElement;
    expect(meta.classList.contains('is-empty')).toBe(false);
    expect(meta.textContent).toContain('胜利街');
    expect(meta.textContent).toContain('5');
  });

  it('阈值内没有路口时只提示，不伪造 Node ID', async () => {
    fetchNearestIntersection.mockResolvedValue(null);
    const { map, head, nodeInput, status } = setup();
    const before = nodeInput().value;
    head.click();
    map.click(114.3, 30.5);
    await vi.waitFor(() => expect(fetchNearestIntersection).toHaveBeenCalled());
    expect(fetchIntersectionTurns).not.toHaveBeenCalled();
    expect(nodeInput().value).toBe(before);
    expect(status()).toContain('附近没有可编辑路口');
  });

  it('缩放级别低于 15 时不发起查询', async () => {
    const { map, head, status } = setup({ zoom: 12 });
    head.click();
    map.click(114.3, 30.5);
    await Promise.resolve();
    expect(fetchNearestIntersection).not.toHaveBeenCalled();
    expect(status()).toContain('15');
  });

  it('收起时移除地图监听', () => {
    const { map, head } = setup();
    head.click();
    expect(map.listenerCount()).toBe(1);
    head.click();
    expect(map.off).toHaveBeenCalled();
    expect(map.listenerCount()).toBe(0);
  });

  it('切换交通模态后清空已选路口', async () => {
    fetchNearestIntersection.mockResolvedValue(INTERSECTION);
    fetchIntersectionTurns.mockResolvedValue(turns());
    const { map, head, editor, nodeInput } = setup();
    head.click();
    map.click(114.3, 30.5);
    await vi.waitFor(() => expect(fetchIntersectionTurns).toHaveBeenCalled());

    editor.setMode('walk');
    expect(nodeInput().value).toBe('');
    expect(document.querySelector('.turn-editor__meta')?.classList.contains('is-empty')).toBe(true);
  });
});
