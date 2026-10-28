export type Entitlement = 'free';

export function getEntitlements(): { tier: Entitlement; features: Record<string, boolean> } {
  return {
    tier: 'free',
    features: {
      everything: true,
    },
  };
}

export function hasFeature(_feature: string): boolean {
  return true;
}
