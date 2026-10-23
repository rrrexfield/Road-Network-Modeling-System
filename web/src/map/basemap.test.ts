import { describe, expect, it } from 'vitest';
import { buildFallbackStyle } from './basemap.js';

describe('buildFallbackStyle', () => {
  it('returns a background-only dark style when the basemap is unreachable', () => {
    const style = buildFallbackStyle();
    expect(style.version).toBe(8);
    expect(style.sources).toEqual({});
    expect(style.layers).toEqual([
      { id: 'bg', type: 'background', paint: { 'background-color': '#101418' } },
    ]);
  });
});
