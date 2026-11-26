export type MapTheme = 'dark' | 'white' | 'normal';

export const MAP_THEME_STORAGE_KEY = 'gisalgo-map-theme';

export const MAP_THEME_OPTIONS: readonly { theme: MapTheme; label: string }[] = [
  { theme: 'dark', label: '深色' },
  { theme: 'white', label: '白色' },
  { theme: 'normal', label: '正常' },
];

export const MAP_THEME_STYLE_URLS: Readonly<Record<MapTheme, string>> = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  white: 'https://tiles.openfreemap.org/styles/positron',
  normal: 'https://tiles.openfreemap.org/styles/liberty',
};

export const MAP_THEME_LABELS: Readonly<Record<MapTheme, string>> = {
  dark: '深色',
  white: '白色',
  normal: '正常',
};

export function normalizeMapTheme(value: unknown): MapTheme {
  return value === 'white' || value === 'normal' || value === 'dark' ? value : 'dark';
}

export function readStoredMapTheme(storage: Pick<Storage, 'getItem'>): MapTheme {
  return normalizeMapTheme(storage.getItem(MAP_THEME_STORAGE_KEY));
}

export function storeMapTheme(storage: Pick<Storage, 'setItem'>, theme: MapTheme): void {
  storage.setItem(MAP_THEME_STORAGE_KEY, theme);
}
