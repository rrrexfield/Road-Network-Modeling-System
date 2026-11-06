import { describe, expect, it } from 'vitest';
import { shouldShowTransferLabels, transferPointSymbol } from './transfer-points-layer.js';

describe('转换点标识', () => {
  it('按转换点类型返回不同字母', () => {
    expect(transferPointSymbol('subway')).toBe('M');
    expect(transferPointSymbol('bus')).toBe('B');
    expect(transferPointSymbol('parking')).toBe('P');
  });

  it('只在放大到路口级后显示字母', () => {
    expect(shouldShowTransferLabels(11)).toBe(false);
    expect(shouldShowTransferLabels(12.49)).toBe(false);
    expect(shouldShowTransferLabels(12.5)).toBe(true);
  });
});
