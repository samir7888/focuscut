import type { IntentCluster } from './cluster';
import type { ZoomSegment } from '../../types/project';
import { ANTICIPATION_MS, HYSTERESIS_MS, MAX_SCALE, MIN_HOLD_MS, MIN_SEGMENT_MS } from './constants';
import { nanoid } from 'nanoid';

const PRESETS = {
  subtle: { minScale: 1.2, maxScale: 1.6, targetFill: 0.55, hold: 800 },
  balanced: { minScale: 1.4, maxScale: 2.2, targetFill: 0.4, hold: 1000 },
  intense: { minScale: 1.6, maxScale: 3.0, targetFill: 0.3, hold: 1200 },
};

function fitScale(targetW: number, frameW: number, targetFill: number, maxScale: number) {
  const scale = frameW / (targetW / targetFill);
  return Math.min(maxScale, Math.max(1.0, scale));
}

export function clustersToSegments(clusters: IntentCluster[], frameW = 1920, preset = 'balanced'): ZoomSegment[] {
  const p = PRESETS[preset as keyof typeof PRESETS] || PRESETS.balanced;
  const segments: ZoomSegment[] = [];
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const intents = cluster.intents;
    const last = intents[intents.length - 1];
    const union = intents.reduce(
      (acc, cur) => {
        const r = cur.targetRect;
        return {
          x: Math.min(acc.x, r.x),
          y: Math.min(acc.y, r.y),
          w: Math.max(acc.x + acc.w, r.x + r.w) - Math.min(acc.x, r.x),
          h: Math.max(acc.y + acc.h, r.y + r.h) - Math.min(acc.y, r.y),
        };
      },
      { ...intents[0].targetRect },
    );
    const useUnion = union.w * union.h < intents[0].targetRect.w * intents[0].targetRect.h * 2.25;
    const target = useUnion ? union : last.targetRect;
    const scale = Math.min(MAX_SCALE, Math.max(p.minScale, fitScale(target.w, frameW, p.targetFill, p.maxScale)));
    const startMs = Math.max(0, cluster.startTime - ANTICIPATION_MS);
    let endMs = cluster.endTime + (p.hold || MIN_HOLD_MS);
    if (endMs - startMs < MIN_SEGMENT_MS) endMs = startMs + MIN_SEGMENT_MS;
    segments.push({
      id: nanoid(),
      startMs,
      endMs,
      scale,
      target: { kind: 'rect', x: target.x, y: target.y, w: target.w, h: target.h },
      source: 'auto',
      reason: last.reason === 'typing' ? 'typing' : last.reason === 'focus' ? 'focus' : last.reason === 'click' || last.reason === 'click-point' ? 'click' : 'hover',
    });
  }
  // Apply hysteresis
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const cur = segments[i];
    if (cur.startMs < prev.endMs + HYSTERESIS_MS) {
      // keep zoom level reasonable, pan directly
    }
  }
  return segments;
}
