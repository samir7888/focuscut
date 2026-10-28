import type { ZoomSegment, PageAnalysis, RecordedEvent } from '../../types/project';
import {
  buildInteractiveTargets,
  getCursorAtTime,
  type InteractiveTarget,
} from '../cursor/cursorEngine';
import { nanoid } from 'nanoid';

export interface CameraState {
  cx: number;
  cy: number;
  scale: number;
  vx: number;
  vy: number;
  vs: number;
}

export interface BakedCameraPath {
  durationMs: number;
  sampleRate: number;
  totalFrames: number;
  samples: Float32Array; // [cx, cy, scale] per frame
  videoW: number;
  videoH: number;
  targets: InteractiveTarget[];
}

/**
 * Pre-bake camera trajectory using critically damped spring dynamics.
 *
 * Content-aware rules (matches Screen Studio / Zoommy style):
 *  - Default: camera stays at video center, no zoom (scale 1.0) — covers all content
 *  - Custom zoom segment active: zoom to the rect's center exactly
 *  - Cursor on interactive element: zoom in, camera follows cursor
 *  - Zoom-in snappy (~0.42s), zoom-out relaxed (~0.85s)
 *  - Hard clamp ensures viewport never moves outside the recorded frame
 */
export function bakeCameraPath(
  durationMs: number,
  videoW: number,
  videoH: number,
  events: RecordedEvent[] = [],
  analysis?: PageAnalysis,
  preset: 'subtle' | 'balanced' | 'intense' = 'balanced',
  customSegments?: ZoomSegment[],
  sampleRate = 120,
): BakedCameraPath {
  const totalFrames = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate) + 2);
  const samples = new Float32Array(totalFrames * 3);
  const dt = 1 / sampleRate;

  const targets = buildInteractiveTargets(durationMs, videoW, videoH, analysis);

  // Interactive-element zoom scale when cursor is on a button/input/link
  const interactiveScaleMap = { subtle: 1.45, balanced: 1.65, intense: 1.85 };
  const interactiveScale = interactiveScaleMap[preset] ?? 1.65;

  // Camera starts centered on the full video frame at scale 1.0
  let state: CameraState = {
    cx: videoW / 2,
    cy: videoH / 2,
    scale: 1.0,
    vx: 0,
    vy: 0,
    vs: 0,
  };

  for (let f = 0; f < totalFrames; f++) {
    const tMs = (f / sampleRate) * 1000;

    const cursor = getCursorAtTime(tMs, durationMs, videoW, videoH, events, targets);

    // ── Determine goal position & scale based on cursor behavior ─────────────
    let goalCx = videoW / 2;   // Default: center of video
    let goalCy = videoH / 2;
    let goalScale = 1.0;        // Default: no zoom (full frame, covers all content)

    // Check cursor behavior:
    // 1. Is the cursor clicking?
    const isClickActive =
      cursor.clickProgress >= 0 ||
      Boolean(events && events.some((e) => e.type === 'click' && tMs >= e.t - 200 && tMs <= e.t + 1000));

    // 2. Is the cursor inside an input field / typing?
    const isInsideInput =
      cursor.interactiveKind === 'input' ||
      cursor.style === 'ibeam' ||
      Boolean(events && events.some((e) => (e.type === 'input' || e.type === 'focus') && Math.abs(tMs - e.t) <= 1800));

    // 3. Is the cursor on ANY button, CTA, link, or clickable element?
    const isButtonActive =
      cursor.interactiveKind === 'button' ||
      cursor.interactiveKind === 'link' ||
      cursor.style === 'pointer' ||
      cursor.isInteractive;

    const isCursorActive = isClickActive || isInsideInput || isButtonActive;

    // Check if an explicit timeline zoom segment is active
    const seg = customSegments?.find((s) => tMs >= s.startMs && tMs <= s.endMs);
    if (seg) {
      goalScale = seg.scale;
      // If user manually drew a custom rectangle in the editor, honor the manual rectangle
      if (seg.source === 'manual' && seg.target.kind === 'rect') {
        goalCx = seg.target.x + seg.target.w / 2;
        goalCy = seg.target.y + seg.target.h / 2;
      } else {
        // Auto segments or follow-cursor segments ALWAYS center on the cursor!
        goalCx = cursor.x;
        goalCy = cursor.y;
      }
    }
    // Dynamic zoom based on cursor behavior (clicking, inside input, or interacting)
    else if (isCursorActive) {
      goalScale = interactiveScale;
      goalCx = cursor.x;
      goalCy = cursor.y;
    }
    // Cursor is moving normally, browsing, idle, or resting:
    // Camera stays at video center, scale 1.0 (full frame, all content in view)

    // ── Content-safe goal clamping BEFORE spring integration ─────────────────
    // Compute half-dimensions of the zoomed viewport in video coords
    const halfGW = videoW / (2 * goalScale);
    const halfGH = videoH / (2 * goalScale);
    // Clamp goal center so the zoomed viewport stays strictly inside the video frame
    goalCx = Math.max(halfGW, Math.min(videoW - halfGW, goalCx));
    goalCy = Math.max(halfGH, Math.min(videoH - halfGH, goalCy));

    // ── Critically damped spring ──────────────────────────────────────────────
    // Zoom-in: snappy ~0.42s.  Zoom-out: relaxed ~0.85s.
    const zoomingIn = goalScale > state.scale;
    const settleTime = zoomingIn ? 0.42 : 0.85;
    const omega = (2 * Math.PI) / settleTime;
    const k = omega * omega;
    const c = 2 * omega;

    const ax = k * (goalCx - state.cx) - c * state.vx;
    const ay = k * (goalCy - state.cy) - c * state.vy;
    const as = k * (goalScale - state.scale) - c * state.vs;

    state.vx += ax * dt;
    state.vy += ay * dt;
    state.vs += as * dt;

    state.cx += state.vx * dt;
    state.cy += state.vy * dt;
    state.scale = Math.max(1.0, state.scale + state.vs * dt);

    // Hard clamp on the actual camera state — viewport can never leave video bounds
    const halfW = videoW / (2 * state.scale);
    const halfH = videoH / (2 * state.scale);
    state.cx = Math.max(halfW, Math.min(videoW - halfW, state.cx));
    state.cy = Math.max(halfH, Math.min(videoH - halfH, state.cy));

    const idx = f * 3;
    samples[idx]     = state.cx;
    samples[idx + 1] = state.cy;
    samples[idx + 2] = state.scale;
  }

  return { durationMs, sampleRate, totalFrames, samples, videoW, videoH, targets };
}

/**
 * Sample camera position at any timestamp (ms) with linear interpolation between pre-baked frames.
 */
export function sampleCameraPath(
  path: BakedCameraPath,
  tMs: number,
): { cx: number; cy: number; scale: number } {
  if (path.totalFrames <= 1) {
    return { cx: path.videoW / 2, cy: path.videoH / 2, scale: 1.0 };
  }

  const frameFloat = Math.max(0, (tMs / 1000) * path.sampleRate);
  const f0 = Math.min(Math.floor(frameFloat), path.totalFrames - 1);
  const f1 = Math.min(f0 + 1, path.totalFrames - 1);
  const frac = frameFloat - f0;

  const idx0 = f0 * 3;
  const idx1 = f1 * 3;

  const cx0 = path.samples[idx0 + 0];
  const cy0 = path.samples[idx0 + 1];
  const sc0 = path.samples[idx0 + 2];

  const cx1 = path.samples[idx1 + 0];
  const cy1 = path.samples[idx1 + 1];
  const sc1 = path.samples[idx1 + 2];

  return {
    cx: cx0 + (cx1 - cx0) * frac,
    cy: cy0 + (cy1 - cy0) * frac,
    scale: sc0 + (sc1 - sc0) * frac,
  };
}

/**
 * Generate zoom segments matching cursor interactive actions (input fields, button clicks).
 * Uses follow-cursor so the camera always centers dynamically on the cursor rather than fixed wrong rects.
 */
export function generateInteractiveZooms(
  durationMs: number,
  videoW: number,
  videoH: number,
  analysis?: PageAnalysis,
  preset: 'subtle' | 'balanced' | 'intense' = 'balanced',
): ZoomSegment[] {
  const targets = buildInteractiveTargets(durationMs, videoW, videoH, analysis);
  const scaleMap = { subtle: 1.4, balanced: 1.65, intense: 1.95 };
  const scale = scaleMap[preset] || 1.65;

  return targets.map((t) => ({
    id: nanoid(),
    startMs: t.startMs,
    endMs: t.endMs,
    scale,
    target: {
      kind: 'follow-cursor',
    },
    source: 'auto',
    reason: t.kind === 'input' ? 'typing' : 'click',
  }));
}
