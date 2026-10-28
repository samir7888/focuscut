export interface CameraState {
  cx: number;
  cy: number;
  scale: number;
}

export interface CameraGoal {
  cx: number;
  cy: number;
  scale: number;
}

export function stepSpring(
  state: CameraState,
  goal: CameraGoal,
  dt: number,
  settleTime = 0.55,
): CameraState {
  const omega = (2 * Math.PI) / settleTime;
  const k = omega * omega;
  const c = 2 * omega;
  
  const ax = k * (goal.cx - state.cx) - c * ( (state as any).vx || 0 );
  const ay = k * (goal.cy - state.cy) - c * ( (state as any).vy || 0 );
  const as = k * (goal.scale - state.scale) - c * ( (state as any).vs || 0 );
  
  const vx = ((state as any).vx || 0) + ax * dt;
  const vy = ((state as any).vy || 0) + ay * dt;
  const vs = ((state as any).vs || 0) + as * dt;
  
  return {
    cx: state.cx + vx * dt,
    cy: state.cy + vy * dt,
    scale: state.scale + vs * dt,
    vx,
    vy,
    vs,
  } as CameraState & { vx: number; vy: number; vs: number };
}

export function clampCamera(state: CameraState, videoW: number, videoH: number): CameraState {
  const halfW = videoW / (2 * state.scale);
  const halfH = videoH / (2 * state.scale);
  return {
    ...state,
    cx: Math.max(halfW, Math.min(videoW - halfW, state.cx)),
    cy: Math.max(halfH, Math.min(videoH - halfH, state.cy)),
  };
}
