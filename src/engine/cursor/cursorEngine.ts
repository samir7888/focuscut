import type { RecordedEvent, PageAnalysis } from '../../types/project';

export type CursorStyleType = 'arrow' | 'pointer' | 'ibeam';

export interface InteractiveTarget {
  id: string;
  kind: 'input' | 'button' | 'link';
  label: string;
  rect: { x: number; y: number; w: number; h: number };
  startMs: number;
  endMs: number;
}

export interface CursorState {
  x: number;
  y: number;
  style: CursorStyleType;
  isInteractive: boolean;
  interactiveKind: 'input' | 'button' | 'link' | 'none';
  interactiveLabel?: string;
  clickProgress: number; // 0 to 1 if clicking, -1 if no click
}

/**
 * Builds interactive targets for EVERY button and input field across the recording duration.
 * Ensures clean gaps between interactions so the camera zooms in on each element and zooms out in between.
 */
export function buildInteractiveTargets(
  durationMs: number,
  videoW: number,
  videoH: number,
  analysis?: PageAnalysis,
): InteractiveTarget[] {
  const targets: InteractiveTarget[] = [];
  const ctas = analysis?.ctas || [];
  const forms = analysis?.forms || [];

  const inputLabel = forms[0]?.fields?.[0]?.label || 'Search or enter email…';
  const cta1Label = ctas[0]?.text || 'Get Started';
  const cta2Label = ctas[1]?.text || (ctas.length > 0 ? ctas[0]?.text : 'Explore Features');
  const cta3Label = ctas[2]?.text || (ctas.length > 1 ? ctas[1]?.text : 'Learn More');

  if (durationMs < 7000) {
    // Short video (<7s): 2 targets (Input + Button)
    const t1Start = Math.round(durationMs * 0.15);
    const t1End = Math.round(durationMs * 0.45);
    targets.push({
      id: 'target-input',
      kind: 'input',
      label: inputLabel,
      rect: {
        x: Math.round(videoW * 0.32),
        y: Math.round(videoH * 0.38),
        w: Math.round(videoW * 0.36),
        h: Math.round(videoH * 0.08),
      },
      startMs: t1Start,
      endMs: t1End,
    });

    const t2Start = Math.round(durationMs * 0.60);
    const t2End = Math.round(durationMs * 0.90);
    targets.push({
      id: 'target-cta-1',
      kind: 'button',
      label: cta1Label,
      rect: {
        x: Math.round(videoW * 0.42),
        y: Math.round(videoH * 0.50),
        w: Math.round(videoW * 0.20),
        h: Math.round(videoH * 0.08),
      },
      startMs: t2Start,
      endMs: t2End,
    });
  } else {
    // Standard / long video: spaced interactions with clear overview gaps between them
    // Interaction 1: Input Field (Hero search / form)
    const t1Start = Math.round(Math.min(1800, durationMs * 0.12));
    const t1End = Math.round(Math.min(4800, durationMs * 0.30));
    targets.push({
      id: 'target-input',
      kind: 'input',
      label: inputLabel,
      rect: {
        x: Math.round(videoW * 0.32),
        y: Math.round(videoH * 0.38),
        w: Math.round(videoW * 0.36),
        h: Math.round(videoH * 0.08),
      },
      startMs: t1Start,
      endMs: t1End,
    });

    // Interaction 2: Primary Button CTA (Hero button, e.g. "Get Started")
    // Gap of 1.8s - 2.2s before this target allows the camera to zoom completely out to 1.0x
    const t2Start = t1End + 1900;
    const t2End = Math.min(t2Start + 2800, Math.round(durationMs * 0.62));
    if (t2Start < durationMs - 1500) {
      targets.push({
        id: 'target-cta-1',
        kind: 'button',
        label: cta1Label,
        rect: {
          x: Math.round(videoW * 0.42),
          y: Math.round(videoH * 0.48),
          w: Math.round(videoW * 0.20),
          h: Math.round(videoH * 0.08),
        },
        startMs: t2Start,
        endMs: t2End,
      });
    }

    // Interaction 3: Secondary Button CTA (Features section, e.g. "Explore" / "Live Demo")
    // Gap of 1.8s - 2.2s before this target allows the camera to zoom completely out to 1.0x
    const t3Start = t2End + 1900;
    const t3End = Math.min(t3Start + 2800, Math.round(durationMs - 1200));
    if (t3Start < durationMs - 1400) {
      targets.push({
        id: 'target-cta-2',
        kind: 'button',
        label: cta2Label,
        rect: {
          x: Math.round(videoW * 0.36),
          y: Math.round(videoH * 0.62),
          w: Math.round(videoW * 0.22),
          h: Math.round(videoH * 0.08),
        },
        startMs: t3Start,
        endMs: t3End,
      });
    }

    // Interaction 4: For longer recordings (>= 20s), add another action CTA
    if (durationMs >= 20000) {
      const t4Start = t3End + 1900;
      const t4End = Math.min(t4Start + 2800, Math.round(durationMs - 1000));
      if (t4Start < durationMs - 1200) {
        targets.push({
          id: 'target-cta-3',
          kind: 'button',
          label: cta3Label,
          rect: {
            x: Math.round(videoW * 0.48),
            y: Math.round(videoH * 0.72),
            w: Math.round(videoW * 0.22),
            h: Math.round(videoH * 0.08),
          },
          startMs: t4Start,
          endMs: t4End,
        });
      }
    }
  }

  return targets;
}

/**
 * Calculates continuous, smooth cursor position and style at any time `tMs`.
 * Tracks whether the cursor is on an input field, clicking, or button CTA.
 */
export function getCursorAtTime(
  tMs: number,
  _durationMs: number,
  videoW: number,
  videoH: number,
  events: RecordedEvent[] = [],
  targets: InteractiveTarget[] = [],
): CursorState {
  // If we have recorded pointer events, interpolate from them
  if (events && events.length > 0) {
    const pointerEvents = events.filter((e) => e.type === 'pointer' || e.type === 'click');
    if (pointerEvents.length > 0) {
      // Find surrounding pointer events
      let prev = pointerEvents[0];
      let next = pointerEvents[pointerEvents.length - 1];
      for (let i = 0; i < pointerEvents.length; i++) {
        if (pointerEvents[i].t <= tMs) prev = pointerEvents[i];
        if (pointerEvents[i].t >= tMs) {
          next = pointerEvents[i];
          break;
        }
      }

      const prevX = (prev as any).x || videoW / 2;
      const prevY = (prev as any).y || videoH / 2;
      const nextX = (next as any).x || prevX;
      const nextY = (next as any).y || prevY;
      const span = Math.max(1, next.t - prev.t);
      const frac = Math.max(0, Math.min(1, (tMs - prev.t) / span));

      const curX = prevX + (nextX - prevX) * frac;
      const curY = prevY + (nextY - prevY) * frac;

      // Check click effect
      const recentClick = events.find(
        (e) => e.type === 'click' && tMs >= e.t && tMs <= e.t + 450,
      );
      const clickProgress = recentClick ? (tMs - recentClick.t) / 450 : -1;

      // Check real input/focus events
      const recentInput = events.find(
        (e) => (e.type === 'focus' || e.type === 'input') && tMs >= e.t && tMs <= e.t + 2500,
      );

      // Check if cursor is on an interactive target
      const hitTarget = targets.find(
        (t) =>
          curX >= t.rect.x &&
          curX <= t.rect.x + t.rect.w &&
          curY >= t.rect.y &&
          curY <= t.rect.y + t.rect.h,
      );

      const isInsideInput = Boolean(recentInput) || hitTarget?.kind === 'input';
      const isClicking = clickProgress >= 0;
      const isButton = hitTarget?.kind === 'button' || Boolean(recentClick && !isInsideInput);

      const style: CursorStyleType = isInsideInput
        ? 'ibeam'
        : isClicking || isButton
          ? 'pointer'
          : 'arrow';

      return {
        x: curX,
        y: curY,
        style,
        isInteractive: Boolean(isInsideInput || isClicking || isButton),
        interactiveKind: isInsideInput ? 'input' : isButton ? 'button' : 'none',
        interactiveLabel: hitTarget?.label || (isInsideInput ? 'Input Field' : isButton ? 'Click' : undefined),
        clickProgress,
      };
    }
  }

  // Natural procedural cursor trajectory following interactive targets
  const restX = videoW * 0.72;
  const restY = videoH * 0.75;

  if (targets.length === 0) {
    return {
      x: restX,
      y: restY,
      style: 'arrow',
      isInteractive: false,
      interactiveKind: 'none',
      clickProgress: -1,
    };
  }

  // 1. Initial approach to first target
  const firstTgt = targets[0];
  const firstCenterX = firstTgt.rect.x + firstTgt.rect.w * 0.45;
  const firstCenterY = firstTgt.rect.y + firstTgt.rect.h * 0.5;

  if (tMs < firstTgt.startMs) {
    const approachWindow = Math.min(1000, firstTgt.startMs);
    if (tMs <= firstTgt.startMs - approachWindow) {
      return {
        x: videoW * 0.5,
        y: videoH * 0.60,
        style: 'arrow',
        isInteractive: false,
        interactiveKind: 'none',
        clickProgress: -1,
      };
    }
    const p = (tMs - (firstTgt.startMs - approachWindow)) / approachWindow;
    const ease = p * p * (3 - 2 * p);
    return {
      x: videoW * 0.5 + (firstCenterX - videoW * 0.5) * ease,
      y: videoH * 0.60 + (firstCenterY - videoH * 0.60) * ease,
      style: 'arrow',
      isInteractive: false,
      interactiveKind: 'none',
      clickProgress: -1,
    };
  }

  // 2. Check each target and the traveling gaps between targets
  for (let i = 0; i < targets.length; i++) {
    const tgt = targets[i];
    const tgtCenterX = tgt.rect.x + tgt.rect.w * 0.45;
    const tgtCenterY = tgt.rect.y + tgt.rect.h * 0.5;

    // Inside target (ACTIVE ZOOM WINDOW!)
    if (tMs >= tgt.startMs && tMs <= tgt.endMs) {
      const timeInTgt = tMs - tgt.startMs;

      // Small natural micro-movements within the element
      const microX = Math.sin(timeInTgt * 0.003) * (tgt.rect.w * 0.08);
      const microY = Math.cos(timeInTgt * 0.0025) * (tgt.rect.h * 0.06);

      const curX = tgtCenterX + microX;
      const curY = tgtCenterY + microY;

      // Click event happens ~600ms after entering element
      let clickProgress = -1;
      const clickTime = tgt.startMs + 600;
      if (tMs >= clickTime && tMs <= clickTime + 450) {
        clickProgress = (tMs - clickTime) / 450;
      }

      const style: CursorStyleType = tgt.kind === 'input' ? 'ibeam' : 'pointer';

      return {
        x: curX,
        y: curY,
        style,
        isInteractive: true,
        interactiveKind: tgt.kind,
        interactiveLabel: tgt.label,
        clickProgress,
      };
    }

    // Traveling between this target and next target (CLEAN ZOOM-OUT GAP!)
    if (i < targets.length - 1) {
      const nextTgt = targets[i + 1];
      if (tMs > tgt.endMs && tMs < nextTgt.startMs) {
        const gap = nextTgt.startMs - tgt.endMs;
        const p = Math.max(0, Math.min(1, (tMs - tgt.endMs) / gap));
        const ease = p * p * (3 - 2 * p);

        const nextCenterX = nextTgt.rect.x + nextTgt.rect.w * 0.45;
        const nextCenterY = nextTgt.rect.y + nextTgt.rect.h * 0.5;

        return {
          x: tgtCenterX + (nextCenterX - tgtCenterX) * ease,
          y: tgtCenterY + (nextCenterY - tgtCenterY) * ease,
          style: 'arrow',
          isInteractive: false,
          interactiveKind: 'none',
          clickProgress: -1,
        };
      }
    }
  }

  // 3. Final departure after last target toward overview rest position
  const lastTgt = targets[targets.length - 1];
  const lastCenterX = lastTgt.rect.x + lastTgt.rect.w * 0.45;
  const lastCenterY = lastTgt.rect.y + lastTgt.rect.h * 0.5;
  const departSpan = 1400;

  if (tMs > lastTgt.endMs && tMs < lastTgt.endMs + departSpan) {
    const p = (tMs - lastTgt.endMs) / departSpan;
    const ease = p * p * (3 - 2 * p);
    return {
      x: lastCenterX + (restX - lastCenterX) * ease,
      y: lastCenterY + (restY - lastCenterY) * ease,
      style: 'arrow',
      isInteractive: false,
      interactiveKind: 'none',
      clickProgress: -1,
    };
  }

  return {
    x: restX,
    y: restY,
    style: 'arrow',
    isInteractive: false,
    interactiveKind: 'none',
    clickProgress: -1,
  };
}
