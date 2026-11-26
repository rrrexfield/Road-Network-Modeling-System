import { describe, expect, it } from 'vitest';
import {
  MAP_THEME_STORAGE_KEY,
  MAP_THEME_STYLE_URLS,
  normalizeMapTheme,
  readStoredMapTheme,
  storeMapTheme,
} from './theme-model.js';

describe('底图主题模型', () => {
  it('三套主题分别映射到深色、白色和标准彩色 style', () => {
    expect(MAP_THEME_STYLE_URLS.dark).toContain('/dark');
    expect(MAP_THEME_STYLE_URLS.white).toContain('/positron');
    expect(MAP_THEME_STYLE_URLS.normal).toContain('/liberty');
  });

  it('非法主题回退深色并可持久化', () => {
    expect(normalizeMapTheme('invalid')).toBe('dark');
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    };
    storeMapTheme(storage, 'white');
    expect(store.get(MAP_THEME_STORAGE_KEY)).toBe('white');
    expect(readStoredMapTheme(storage)).toBe('white');
  });
});
