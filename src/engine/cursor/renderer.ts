import type { CursorState } from './cursorEngine';

/**
 * Draws the custom cursor and click effects onto the canvas at screen coordinates.
 * Keeps cursor size constant, perfectly visible, and razor-sharp.
 */
export function drawCursor(
  ctx: CanvasRenderingContext2D,
  cursor: CursorState,
  screenX: number,
  screenY: number,
  scale = 1.0,
): void {
  ctx.save();

  // Draw expanding golden click ripple if click is in progress
  if (cursor.clickProgress >= 0 && cursor.clickProgress <= 1.0) {
    const p = cursor.clickProgress;
    const r = 4 + p * 24; // expands from 4px to 28px
    const alpha = (1 - p) * 0.85;

    ctx.save();
    ctx.strokeStyle = `rgba(245, 194, 66, ${alpha})`;
    ctx.lineWidth = 2.5 * (1 - p * 0.4);
    ctx.beginPath();
    ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
    ctx.stroke();

    // Inner subtle glow
    ctx.fillStyle = `rgba(245, 194, 66, ${alpha * 0.25})`;
    ctx.beginPath();
    ctx.arc(screenX, screenY, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Soft drop shadow for the cursor so it pops over any dark or light background
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2;

  // Slight squish effect when clicking
  const squish = cursor.clickProgress >= 0 && cursor.clickProgress < 0.3 ? 0.92 : 1.0;
  const cursorScale = scale * squish;

  ctx.translate(screenX, screenY);
  ctx.scale(cursorScale, cursorScale);

  if (cursor.style === 'pointer') {
    // Modern Pointer Hand (for Button CTA & Links)
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#121418';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    // Hand shape
    ctx.moveTo(0, 0); // index tip
    ctx.lineTo(0, 10);
    ctx.lineTo(2, 10);
    ctx.lineTo(2, 4);
    ctx.lineTo(5, 4);
    ctx.lineTo(5, 12);
    ctx.lineTo(7, 12);
    ctx.lineTo(7, 6);
    ctx.lineTo(10, 6);
    ctx.lineTo(10, 13);
    ctx.lineTo(12, 13);
    ctx.lineTo(12, 8);
    ctx.lineTo(14, 8);
    ctx.lineTo(14, 15);
    ctx.lineTo(12, 20);
    ctx.lineTo(3, 20);
    ctx.lineTo(-2, 14);
    ctx.lineTo(-2, 8);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();
  } else if (cursor.style === 'ibeam') {
    // I-Beam (for Input fields & text)
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#121418';
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    // Top bar
    ctx.moveTo(-4, -8);
    ctx.lineTo(4, -8);
    // Vertical stem
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 8);
    // Bottom bar
    ctx.moveTo(-4, 8);
    ctx.lineTo(4, 8);

    ctx.stroke();

    // Central accent tick
    ctx.strokeStyle = '#F5C242';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(2, 0);
    ctx.stroke();
  } else {
    // Default crisp macOS-style arrow cursor
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#121418';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17);
    ctx.lineTo(4.5, 13);
    ctx.lineTo(8.5, 21.5);
    ctx.lineTo(11.5, 20);
    ctx.lineTo(7.5, 11.5);
    ctx.lineTo(13.5, 11.5);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
