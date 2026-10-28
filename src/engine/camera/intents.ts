import type { RecordedEvent, ElementRef } from '../../types/project';

export type IntentReason = 'focus' | 'typing' | 'click' | 'click-point' | 'hover';
export interface Intent {
  t: number;
  reason: IntentReason;
  targetRect: { x: number; y: number; w: number; h: number };
  elementRef?: ElementRef;
}

const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'textarea', 'select', 'label']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'textbox', 'combobox', 'searchbox']);

function isInteractive(ref?: ElementRef) {
  if (!ref) return false;
  if (INTERACTIVE_TAGS.has(ref.tag)) return true;
  if (ref.role && INTERACTIVE_ROLES.has(ref.role)) return true;
  return false;
}

export function eventsToIntents(events: RecordedEvent[]): Intent[] {
  const intents: Intent[] = [];
  for (const ev of events) {
    if (ev.type === 'focus' && ev.target) {
      intents.push({
        t: ev.t,
        reason: 'focus',
        targetRect: ev.target.rect,
        elementRef: ev.target,
      });
    } else if (ev.type === 'input' && ev.target) {
      intents.push({
        t: ev.t,
        reason: 'typing',
        targetRect: ev.target.rect,
        elementRef: ev.target,
      });
    } else if (ev.type === 'click') {
      const ref = ev.target;
      if (ref && isInteractive(ref)) {
        intents.push({
          t: ev.t,
          reason: 'click',
          targetRect: ref.rect,
          elementRef: ref,
        });
      } else {
        const size = 80;
        intents.push({
          t: ev.t,
          reason: 'click-point',
          targetRect: { x: ev.x - size / 2, y: ev.y - size / 2, w: size, h: size },
        });
      }
    }
  }
  return intents.sort((a, b) => a.t - b.t);
}
