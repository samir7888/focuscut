export function cssRectToVideoRect(
  cssRect: { x: number; y: number; w: number; h: number },
  _video: { width: number; height: number },
  dpr: number,
) {
  return {
    x: cssRect.x * dpr,
    y: cssRect.y * dpr,
    w: cssRect.w * dpr,
    h: cssRect.h * dpr,
  };
}

export function videoRectToCssRect(
  videoRect: { x: number; y: number; w: number; h: number },
  dpr: number,
) {
  return {
    x: videoRect.x / dpr,
    y: videoRect.y / dpr,
    w: videoRect.w / dpr,
    h: videoRect.h / dpr,
  };
}

export function isPointInRect(x: number, y: number, rect: { x: number; y: number; w: number; h: number }) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}
