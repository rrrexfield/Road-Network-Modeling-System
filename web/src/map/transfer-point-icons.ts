/**
 * 模态转换点的图标(Font Awesome Free)。
 *
 * 为什么用图标而不是字母:P / B / M 三个字母含义不直观(M 既像地铁也像缩写),
 * 图标在小尺寸下也能区分;图标内联为 SVG 字符串,直接进 DOM,**不依赖 webfont、
 * 也不经过任何图片解码管线**(答辩现场常常无外网,且 deck.gl 的图片加载在部分
 * Chromium 上会把无 MIME 的 Blob 直接解码失败)。
 */
import type { TransferPoint } from '@gisalgo/shared';
import { icon } from '@fortawesome/fontawesome-svg-core';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faBus, faSquareParking, faTrainSubway } from '@fortawesome/free-solid-svg-icons';

/** 各转换点类型对应的 Font Awesome 图标。 */
const ICON_DEFINITIONS: Record<TransferPoint['kind'], IconDefinition> = {
  parking: faSquareParking,
  bus: faBus,
  subway: faTrainSubway,
};

/** 图标底板与字形的颜色(与底板描边同一金色)。 */
const BACKING_FILL = 'rgba(14, 19, 23, 0.92)';
const BACKING_STROKE = 'rgba(242, 198, 109, 0.55)';
const GLYPH_FILL = '#f2c66d';

/** 图标画布边长(与 CSS 中的图标尺寸保持一致)。 */
const CANVAS = 24;
/** 字形在画布内的留白。 */
const PADDING = 5;

/**
 * 取转换点类型的图标路径数据。
 * @param kind 转换点类型。
 * @returns SVG 的 path 数据与原始宽高。
 */
function glyphOf(kind: TransferPoint['kind']): { path: string; width: number; height: number } {
  const rendered = icon(ICON_DEFINITIONS[kind]);
  const [width, height, , , raw] = rendered.icon;
  // FA 的类型声明把 path 写成 string[],实际是单条 path 字符串;两种形态都兜住。
  return { path: Array.isArray(raw) ? raw.join(' ') : raw, width, height };
}

/**
 * 生成转换点图标的**内联 SVG** 标记(带深色圆角底板 + 金色字形)。
 *
 * @param kind 转换点类型。
 * @returns 可直接插入 DOM 的 SVG 字符串。
 * @remarks 字符串只由本地常量与 FA 的路径数据拼成，不含任何外部输入，
 * 因此用 `innerHTML` 插入是安全的。
 */
export function transferPointIconMarkup(kind: TransferPoint['kind']): string {
  const { path, width, height } = glyphOf(kind);
  // 字形等比缩放到画布内(留 PADDING 边距),再平移到位。
  const scale = (CANVAS - PADDING * 2) / Math.max(width, height);
  const offsetX = PADDING + ((CANVAS - PADDING * 2 - width * scale) / 2);
  const offsetY = PADDING + ((CANVAS - PADDING * 2 - height * scale) / 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="100%" height="100%">` +
    `<rect x="0.5" y="0.5" width="${CANVAS - 1}" height="${CANVAS - 1}" rx="6" ` +
    `fill="${BACKING_FILL}" stroke="${BACKING_STROKE}"/>` +
    `<path transform="translate(${offsetX.toFixed(3)} ${offsetY.toFixed(3)}) scale(${scale.toFixed(5)})" ` +
    `fill="${GLYPH_FILL}" d="${path}"/>` +
    '</svg>'
  );
}
