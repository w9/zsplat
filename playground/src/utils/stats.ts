export const FPS_SAMPLES_CAP = 2000;

export type RunningStats = {
  avg: number;
  min: number;
  max: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
};

export function computeRunningStats(samples: number[]): RunningStats | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const lerp = (arr: number[], t: number) => {
    const i = Math.max(0, Math.min(n - 1, t * (n - 1)));
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return lo === hi ? arr[lo] : arr[lo] + (i - lo) * (arr[hi] - arr[lo]);
  };
  return {
    avg: sum / n,
    min: sorted[0],
    max: sorted[n - 1],
    p5: lerp(sorted, 0.05),
    p25: lerp(sorted, 0.25),
    p50: lerp(sorted, 0.5),
    p75: lerp(sorted, 0.75),
    p95: lerp(sorted, 0.95),
  };
}
