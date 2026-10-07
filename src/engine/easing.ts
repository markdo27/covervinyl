export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp01(t), 3);
export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** Smooth deceleration used for most motion — similar to iOS / After Effects "ease out expo". */
export const easeOutExpo = (t: number) => {
  const x = clamp01(t);
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
};
/** Derivative of easeOutExpo, normalised so it can drive motion blur. */
export const easeOutExpoVelocity = (t: number) => {
  const x = clamp01(t);
  if (x <= 0 || x >= 1) return 0;
  return 10 * Math.LN2 * Math.pow(2, -10 * x);
};
