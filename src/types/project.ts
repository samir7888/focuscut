export type Ms = number;

export interface Project {
  id: string;
  version: 1;
  name: string;
  createdAt: number;
  updatedAt: number;
  media: {
    videoBlobId: string;
    audioBlobId?: string;
    width: number;
    height: number;
    durationMs: Ms;
    devicePixelRatio: number;
  };
  events: RecordedEvent[];
  analysis?: PageAnalysis;
  edit: EditState;
}

export type RecordedEvent =
  | { t: Ms; type: 'pointer'; x: number; y: number }
  | { t: Ms; type: 'click'; x: number; y: number; button: number; target?: ElementRef }
  | { t: Ms; type: 'focus'; target: ElementRef }
  | { t: Ms; type: 'blur'; target: ElementRef }
  | { t: Ms; type: 'input'; target: ElementRef }
  | { t: Ms; type: 'key'; combo: string }
  | { t: Ms; type: 'scroll'; x: number; y: number }
  | { t: Ms; type: 'viewport'; w: number; h: number; dpr: number };

export interface ElementRef {
  selector: string;
  tag: string;
  role?: string;
  label?: string;
  rect: { x: number; y: number; w: number; h: number };
}

export interface EditState {
  trim: { startMs: Ms; endMs: Ms };
  zooms: ZoomSegment[];
  speeds: SpeedSegment[];
  overlays: Overlay[];
  cursor: CursorStyle;
  frame: FrameStyle;
  output: OutputSettings;
  zoomPreset: 'subtle' | 'balanced' | 'intense';
}

export interface ZoomSegment {
  id: string;
  startMs: Ms;
  endMs: Ms;
  scale: number;
  target:
    | { kind: 'rect'; x: number; y: number; w: number; h: number }
    | { kind: 'follow-cursor' };
  source: 'auto' | 'manual';
  reason?: 'click' | 'focus' | 'typing' | 'hover';
  locked?: boolean;
}

export interface SpeedSegment {
  id: string;
  startMs: Ms;
  endMs: Ms;
  rate: number;
}

export type OverlayType =
  | 'titleCard'
  | 'lowerThird'
  | 'featureCard'
  | 'callout'
  | 'stat'
  | 'stepBadge'
  | 'ctaCard'
  | 'text'
  | 'blur';

export interface Overlay {
  id: string;
  type: OverlayType;
  startMs: Ms;
  endMs: Ms;
  anchor: 'screen' | { kind: 'element'; rect: { x: number; y: number; w: number; h: number } };
  style: Record<string, unknown>;
  content: Record<string, unknown>;
}

export interface CursorStyle {
  size: number;
  style: 'arrow' | 'pointer' | 'ibeam';
  showClickEffect: boolean;
  idleHideMs: number;
  constantSizeWhenZoomed: boolean;
}

export interface FrameStyle {
  background: { type: 'solid' | 'gradient' | 'image' | 'from-page'; value: string };
  padding: number;
  radius: number;
  shadow: boolean;
  border: boolean;
  mockup: 'none' | 'minimal';
}

export interface OutputSettings {
  aspect: '16:9' | '1:1' | '4:5' | '9:16';
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
}

export interface PageAnalysis {
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  logo?: string;
  brand: { colors: string[]; fonts: string[] };
  headings: { level: 1 | 2 | 3; text: string }[];
  features: { title: string; text?: string }[];
  ctas: { text: string; selector?: string; rect?: { x: number; y: number; w: number; h: number } }[];
  forms: { label?: string; fields: { label?: string; type: string; selector?: string }[] }[];
  stats: { value: string; label: string }[];
  pricing?: { plan: string; price: string }[];
  testimonials?: { quote: string; author?: string }[];
  summary?: { tagline: string; bullets: string[]; script: string[] };
}
