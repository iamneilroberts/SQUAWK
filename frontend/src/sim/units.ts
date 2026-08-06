/*
 * SI is the only internal unit system. These conversions exist so that the feed edge
 * (knots/feet/fpm from readsb) and the display edge (HUD) can speak aviation units while
 * everything between them speaks metres, seconds, radians and newtons.
 */
export const KT_TO_MS = 0.5144444444444445; // 1 nm = 1852 m, per hour
export const FT_TO_M = 0.3048;
export const MS_TO_FPM = 196.85039370078738; // (1 / 0.3048) * 60

export function ktToMs(kt: number): number {
  return kt * KT_TO_MS;
}
export function msToKt(ms: number): number {
  return ms / KT_TO_MS;
}
export function ftToM(ft: number): number {
  return ft * FT_TO_M;
}
export function mToFt(m: number): number {
  return m / FT_TO_M;
}
export function msToFpm(ms: number): number {
  return ms * MS_TO_FPM;
}
export function fpmToMs(fpm: number): number {
  return fpm / MS_TO_FPM;
}
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
