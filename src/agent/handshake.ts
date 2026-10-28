export interface HandshakeResult {
  agentOffset: number;
  rtt: number;
}

export async function performHandshake(
  agentWindow: Window,
  _studioOrigin: string,
  targetOrigin: string,
  count = 5,
): Promise<HandshakeResult> {
  const pings: Array<{ agentTime: number; studioTime: number; rtt: number }> = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    agentWindow.postMessage({ type: 'hello', studioTime: start, wall: Date.now() }, targetOrigin);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // In real impl, collect replies via message listener
    const end = performance.now();
    pings.push({ agentTime: start, studioTime: start, rtt: end - start });
  }
  pings.sort((a, b) => a.rtt - b.rtt);
  const best = pings[0];
  return { agentOffset: best.studioTime - best.agentTime - best.rtt / 2, rtt: best.rtt };
}
