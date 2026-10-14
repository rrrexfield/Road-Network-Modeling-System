import { describe, expect, it } from 'vitest';
import { PriorityQueue } from './index.js';

describe('PriorityQueue', () => {
  it('按 key 升序弹出', () => {
    const pq = new PriorityQueue<string>();
    pq.push(5, 'e');
    pq.push(1, 'a');
    pq.push(3, 'c');
    pq.push(2, 'b');
    const out: string[] = [];
    while (pq.size > 0) out.push(pq.pop()!.value);
    expect(out).toEqual(['a', 'b', 'c', 'e']);
  });

  it('peek 返回最小 key 且不弹出', () => {
    const pq = new PriorityQueue<number>();
    pq.push(3, 30);
    pq.push(1, 10);
    expect(pq.peek()).toEqual({ key: 1, value: 10 });
    expect(pq.size).toBe(2);
  });

  it('重复 key 均可弹出', () => {
    const pq = new PriorityQueue<number>();
    pq.push(2, 1);
    pq.push(2, 2);
    pq.push(2, 3);
    expect(pq.pop()!.key).toBe(2);
    expect(pq.pop()!.key).toBe(2);
    expect(pq.pop()!.key).toBe(2);
    expect(pq.pop()).toBeUndefined();
  });

  it('空堆 pop 返回 undefined', () => {
    const pq = new PriorityQueue<number>();
    expect(pq.pop()).toBeUndefined();
    expect(pq.size).toBe(0);
  });
});
