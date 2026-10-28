export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
}

export interface Renderer {
  render(rc: RenderContext): void;
}
