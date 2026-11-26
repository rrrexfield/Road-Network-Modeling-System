import { describe, expect, it } from 'vitest';
import {
  buildFallbackStyle,
  transportationLayerIds,
  withoutTransportationLayers,
} from './basemap.js';

describe('buildFallbackStyle', () => {
  it('returns a background-only dark style when the basemap is unreachable', () => {
    const style = buildFallbackStyle();
    expect(style.version).toBe(8);
    expect(style.sources).toEqual({});
    expect(style.layers).toEqual([
      { id: 'bg', type: 'background', paint: { 'background-color': '#101418' } },
    ]);
  });

  it('uses the selected theme color for offline fallback', () => {
    expect(buildFallbackStyle('white').layers).toEqual([
      { id: 'bg', type: 'background', paint: { 'background-color': '#f4f5f5' } },
    ]);
    expect(buildFallbackStyle('normal').layers).toEqual([
      { id: 'bg', type: 'background', paint: { 'background-color': '#dfe4e7' } },
    ]);
  });

  it('identifies only transportation layers for suppression', () => {
    const layers = [
      {
        id: 'road-main',
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation',
      },
      {
        id: 'road-label',
        type: 'symbol' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
      },
      {
        id: 'water',
        type: 'fill' as const,
        source: 'openmaptiles',
        'source-layer': 'water',
      },
    ];
    expect(transportationLayerIds(layers)).toEqual(['road-main', 'road-label']);
    const processed = withoutTransportationLayers({ version: 8, sources: {}, layers });
    expect(processed.layers.map((layer) => layer.id)).toEqual(['water']);
  });
});
