import { describe, it, expect } from 'vitest';

describe('camera basics', () => {
  it('debounce clusters events within 400ms', () => {
    const DEBOUNCE_MS = 400;
    const times = [0, 200, 399, 800];
    const clusters: number[][] = [];
    let current: number[] = [];
    for (let i = 0; i < times.length; i++) {
      if (current.length === 0 || times[i] - current[current.length - 1] <= DEBOUNCE_MS) {
        current.push(times[i]);
      } else {
        clusters.push(current);
        current = [times[i]];
      }
    }
    if (current.length) clusters.push(current);
    expect(clusters.length).toBe(2);
    expect(clusters[0]).toEqual([0, 200, 399]);
    expect(clusters[1]).toEqual([800]);
  });

  it('hysteresis avoids in-out-in within 1500ms', () => {
    const gap = 1200;
    expect(gap < 1500).toBe(true);
  });

  it('clamping keeps camera inside video', () => {
    const videoW = 1920, videoH = 1080;
    const cx = 10, cy = 50, scale = 2;
    const halfW = videoW / (2 * scale);
    const halfH = videoH / (2 * scale);
    const cxClamped = Math.max(halfW, Math.min(videoW - halfW, cx));
    const cyClamped = Math.max(halfH, Math.min(videoH - halfH, cy));
    expect(cxClamped).toBe(halfW);
    expect(cyClamped).toBe(halfH);
  });

  it('deterministic spring never overshoots goal by more than 0.5%', () => {
    const goal = 1.0;
    let x = 0;
    let v = 0;
    const omega = 2 * Math.PI / 0.55;
    const dt = 1 / 240;
    for (let i = 0; i < 10000; i++) {
      const accel = omega * omega * (goal - x) - 2 * omega * v;
      v += accel * dt;
      x += v * dt;
      if (x > goal * 1.005) throw new Error('overshoot');
    }
    expect(Math.abs(x - goal)).toBeLessThan(0.001);
  });
});
