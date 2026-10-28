import { describe, it, expect } from 'vitest';
import { toVideoTime } from '../src/engine/sync';

describe('toVideoTime', () => {
  it('computes video time with offsets', () => {
    const agentNow = 1000;
    const agentOffset = 50;
    const recordStartWall = 2000;
    const studioWallAtHandshake = 1900;
    const t = toVideoTime(agentNow, agentOffset, recordStartWall, studioWallAtHandshake);
    expect(t).toBe(1000 - 50 - (2000 - 1900));
  });

  it('drops negative times when applied', () => {
    const t = toVideoTime(10, 100, 1000);
    expect(t).toBeLessThan(0);
  });
});
