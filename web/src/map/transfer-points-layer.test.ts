import { describe, expect, it } from 'vitest';
import { transferPointIconMarkup } from './transfer-point-icons.js';
import { shouldShowTransferLabels, transferPointIconScale } from './transfer-points-layer.js';

describe('转换点图标', () => {
  it('每种转换点类型生成各自的内联 SVG', () => {
    const markup = {
      parking: transferPointIconMarkup('parking'),
      bus: transferPointIconMarkup('bus'),
      subway: transferPointIconMarkup('subway'),
    };
    for (const [kind, svg] of Object.entries(markup)) {
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('</svg>');
      expect(svg).toContain('transfer-point-marker__backing');
      expect(svg).toContain('transfer-point-marker__glyph');
      expect(svg.length).toBeGreaterThan(100);
      expect(kind.length).toBeGreaterThan(0);
    }
    // 三种类型的字形路径互不相同
    expect(new Set(Object.values(markup)).size).toBe(3);
  });

  it('SVG 不引用任何外部资源(离线可用,不依赖 webfont)', () => {
    const svg = transferPointIconMarkup('bus');
    // 只允许 SVG 命名空间(http://www.w3.org/2000/svg),不得引用任何外部地址或资源
    expect(svg).not.toContain('https://');
    expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toContain('http');
    expect(svg).not.toContain('@font-face');
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('href');
  });

  it('只在放大到路口级后显示图标', () => {
    expect(shouldShowTransferLabels(12)).toBe(false);
    expect(shouldShowTransferLabels(14.99)).toBe(false);
    expect(shouldShowTransferLabels(15)).toBe(true);
  });

  it('路口级图标随缩放继续变大并封顶', () => {
    expect(transferPointIconScale(15)).toBe(1);
    expect(transferPointIconScale(17)).toBeGreaterThan(1);
    expect(transferPointIconScale(20)).toBeGreaterThan(2);
    expect(transferPointIconScale(30)).toBe(2.4);
  });
});
