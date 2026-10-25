/** Overview ends below .4 zoom. Retain oversampling and the existing 4096px texture cap. */
export function overviewRasterScale(
  width: number,
  height: number,
  dpr: number,
) {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(
    0.65 * ratio,
    4096 / Math.max(1, width),
    4096 / Math.max(1, height),
  );
}
