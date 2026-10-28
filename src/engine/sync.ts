export interface SyncResult {
  offsetMs: number;
  rttMs: number;
}

export function toVideoTime(agentNow: number, agentOffset: number, recordStartWall: number, studioWallAtHandshake?: number): number {
  // t = agentNow - agentOffset - (recordStartWall - studioWallAtHandshake...)
  const base = recordStartWall - (studioWallAtHandshake || recordStartWall);
  return agentNow - agentOffset - base;
}

export function computeMedianOffset(pings: Array<{ agentTime: number; studioTime: number; rtt: number }>): SyncResult {
  if (pings.length === 0) return { offsetMs: 0, rttMs: 0 };
  const sorted = [...pings].sort((a, b) => a.rtt - b.rtt);
  const best = sorted[0];
  // rough offset estimate
  const offset = best.studioTime - best.agentTime - best.rtt / 2;
  return { offsetMs: offset, rttMs: best.rtt };
}
