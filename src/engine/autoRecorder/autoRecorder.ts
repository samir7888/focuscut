import { nanoid } from 'nanoid';
import type { PageAnalysis, Project, ZoomSegment } from '../../types/project';
import { saveBlob, saveProject } from '../../storage/db';
import { generateInteractiveZooms } from '../camera/baker';

export interface AutoRecordProgress {
  phase: string;
  percent: number;
  instruction?: string;
}

/**
 * Opens the real website in a new window and uses getDisplayMedia (tab capture)
 * to record the actual page. The user selects the opened tab in the browser
 * picker. Recording runs for ~16 seconds with timed scroll instructions shown
 * in the progress overlay, then saves directly to IndexedDB.
 */
export async function runAutoRecording(
  analysis: PageAnalysis,
  onProgress?: (p: AutoRecordProgress) => void,
): Promise<{ projectId: string; durationMs: number }> {
  const targetUrl = analysis.url;
  const totalDurationMs = 16000;

  onProgress?.({
    phase: 'Opening websiteâ€¦',
    percent: 5,
    instruction: 'A new browser window is opening with your website.',
  });

  const siteWindow = window.open(
    targetUrl,
    '_blank',
    'width=1280,height=800,menubar=no,toolbar=no,location=yes,status=no',
  );

  await sleep(1200);

  onProgress?.({
    phase: 'Select the website tab to record',
    percent: 10,
    instruction:
      'In the browser picker that just appeared, select the tab showing your website, then click Share.',
  });

  let stream: MediaStream;
  try {
    stream = await (navigator.mediaDevices as any).getDisplayMedia({
      video: {
        displaySurface: 'browser',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'exclude',
    });
  } catch (err: any) {
    siteWindow?.close();
    throw new Error(
      err?.name === 'NotAllowedError'
        ? 'Screen capture was cancelled. Please try again and select the website tab.'
        : `Could not start screen capture: ${err?.message || err}`,
    );
  }

  onProgress?.({
    phase: 'Recording started â€” capturing real website',
    percent: 15,
    instruction: 'Recording is live! Follow the instructions below.',
  });

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    ? 'video/webm;codecs=vp8'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.start(500);

  const recordingStartMs = Date.now();

  const phases: Array<{
    atMs: number;
    phase: string;
    instruction: string;
    percent: number;
  }> = [
    {
      atMs: 0,
      percent: 20,
      phase: 'Overview: Landing Page',
      instruction: 'ðŸ“¸ Stay on the hero section â€” let viewers see the full landing page.',
    },
    {
      atMs: 2500,
      percent: 35,
      phase: 'Zoom in: Hero & Headline',
      instruction: 'ðŸ” Zoom in (Ctrl +) on the headline and main CTA button.',
    },
    {
      atMs: 5500,
      percent: 55,
      phase: 'Scroll: Key Features',
      instruction: 'ðŸ“œ Scroll down slowly to reveal the key features section.',
    },
    {
      atMs: 9000,
      percent: 75,
      phase: 'Highlight: Call to Action',
      instruction: 'ðŸ‘† Hover over the CTA button â€” let it shine!',
    },
    {
      atMs: 12000,
      percent: 88,
      phase: 'Final: Scroll back to top',
      instruction: 'â¬†ï¸ Scroll back up to the hero section to end on a high note.',
    },
    {
      atMs: 14500,
      percent: 95,
      phase: 'Wrapping upâ€¦',
      instruction: 'âœ… Almost done! Hold position.',
    },
  ];

  await new Promise<void>((resolve) => {
    let phaseIndex = 0;

    const tick = setInterval(() => {
      const elapsedMs = Date.now() - recordingStartMs;

      while (
        phaseIndex < phases.length - 1 &&
        elapsedMs >= phases[phaseIndex + 1].atMs
      ) {
        phaseIndex++;
      }

      const cur = phases[phaseIndex];
      onProgress?.({
        phase: cur.phase,
        percent: cur.percent,
        instruction: cur.instruction,
      });

      if (elapsedMs >= totalDurationMs) {
        clearInterval(tick);
        resolve();
      }
    }, 250);
  });

  onProgress?.({ phase: 'Finalizingâ€¦', percent: 97 });

  const recordedBlob = await new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      const full = new Blob(chunks, { type: mimeType });
      resolve(full);
    };
    recorder.stop();
  });

  stream.getTracks().forEach((t) => t.stop());
  try { siteWindow?.close(); } catch (_) { /* ignore */ }

  const videoTrack = stream.getVideoTracks()[0];
  const settings = videoTrack?.getSettings?.() ?? {};
  const vidWidth = (settings.width as number) || 1920;
  const vidHeight = (settings.height as number) || 1080;

  const actualDurationMs = Date.now() - recordingStartMs;

  onProgress?.({ phase: 'Saving to Libraryâ€¦', percent: 98 });

  const blobId = nanoid();
  await saveBlob(blobId, 'video', recordedBlob);

  // Follow-cursor auto zooms matching cursor actions (input field typing, CTA button click)
  // No fixed rectangles in wrong places — camera dynamically tracks cursor
  const zooms = buildZoomSegments(analysis, vidWidth, vidHeight, actualDurationMs);

  const projectId = nanoid();
  const project: Project = {
    id: projectId,
    version: 1,
    name: `${analysis.title} — Auto Recording`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    media: {
      videoBlobId: blobId,
      width: vidWidth,
      height: vidHeight,
      durationMs: actualDurationMs,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    events: [],
    analysis,
    edit: {
      trim: { startMs: 0, endMs: actualDurationMs },
      zooms,
      speeds: [],
      overlays: [],
      cursor: {
        size: 1,
        style: 'arrow',
        showClickEffect: true,
        idleHideMs: 2500,
        constantSizeWhenZoomed: true,
      },
      frame: {
        background: { type: 'solid', value: '#0F1117' },
        padding: 6,
        radius: 12,
        shadow: true,
        border: false,
        mockup: 'minimal',
      },
      output: {
        aspect: '16:9',
        width: vidWidth,
        height: vidHeight,
        fps: 30,
        bitrateKbps: 8000,
      },
      zoomPreset: 'balanced',
    },
  };

  await saveProject(project);

  return { projectId, durationMs: actualDurationMs };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Builds clean, cursor-following zoom segments for auto-recorded pages.
 * Zooms occur every time the cursor is on any button or input field,
 * and always follow the cursor rather than jumping to fixed wrong rectangles.
 */
function buildZoomSegments(
  analysis: PageAnalysis,
  w: number,
  h: number,
  durationMs: number,
): ZoomSegment[] {
  return generateInteractiveZooms(durationMs, w, h, analysis, 'balanced');
}