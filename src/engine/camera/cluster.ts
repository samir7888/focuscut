import type { Intent } from './intents';
import { DEBOUNCE_MS } from './constants';

export interface IntentCluster {
  intents: Intent[];
  startTime: number;
  endTime: number;
}

export function clusterIntents(intents: Intent[]): IntentCluster[] {
  if (intents.length === 0) return [];
  const clusters: IntentCluster[] = [];
  let current: Intent[] = [intents[0]];

  for (let i = 1; i < intents.length; i++) {
    const last = current[current.length - 1];
    const cur = intents[i];
    if (cur.t - last.t <= DEBOUNCE_MS) {
      current.push(cur);
    } else {
      clusters.push({
        intents: current,
        startTime: current[0].t,
        endTime: current[current.length - 1].t,
      });
      current = [cur];
    }
  }
  if (current.length) {
    clusters.push({
      intents: current,
      startTime: current[0].t,
      endTime: current[current.length - 1].t,
    });
  }
  return clusters;
}
