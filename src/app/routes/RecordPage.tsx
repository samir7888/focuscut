import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { useProjectStore } from '../../stores/projectStore';
import { saveBlob, saveChunk, getChunks } from '../../storage/db';
import type { Project } from '../../types/project';

type RecordState = 'idle' | 'requesting' | 'countdown' | 'recording' | 'paused' | 'stopped' | 'saving' | 'error';

function defaultProject(id: string, name: string, w: number, h: number, durationMs: number, blobId: string): Project {
  return {
    id,
    version: 1,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    media: {
      videoBlobId: blobId,
      width: w,
      height: h,
      durationMs,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    events: [],
    edit: {
      trim: { startMs: 0, endMs: durationMs },
      zooms: [],
      speeds: [],
      overlays: [],
      cursor: { size: 1, style: 'arrow', showClickEffect: true, idleHideMs: 2500, constantSizeWhenZoomed: false },
      frame: {
        background: { type: 'solid', value: '#121418' },
        padding: 5,
        radius: 14,
        shadow: true,
        border: false,
        mockup: 'minimal',
      },
      output: { aspect: '16:9', width: 1920, height: 1080, fps: 30, bitrateKbps: 8000 },
      zoomPreset: 'balanced',
    },
  };
}

export function RecordPage() {
  const navigate = useNavigate();
  const pendingAnalysis = useProjectStore((s) => s.pendingAnalysis);
  const persistProject = useProjectStore((s) => s.persistProject);

  const [state, setState] = useState<RecordState>('idle');
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);  // ms
  const [errorMsg, setErrorMsg] = useState('');

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingIdRef = useRef<string>(nanoid());
  const chunkIndexRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);
  const recordedEventsRef = useRef<any[]>([]);
  const startTimeRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  const startElapsedTimer = useCallback(() => {
    elapsedTimerRef.current = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, 250);
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  // Start: request screen share, then countdown, then record
  const handleStartRecording = async () => {
    setState('requesting');
    setErrorMsg('');

    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: {
          displaySurface: 'browser',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,  // audio can be added optionally
        preferCurrentTab: false,
      });

      streamRef.current = stream;

      // If user stops sharing via browser controls, treat as stop
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        handleStop();
      });

      // Countdown
      setState('countdown');
      let count = 3;
      setCountdown(count);
      await new Promise<void>((resolve) => {
        const iv = setInterval(() => {
          count--;
          setCountdown(count);
          if (count <= 0) {
            clearInterval(iv);
            resolve();
          }
        }, 1000);
      });

      // Start recording
      recordingIdRef.current = nanoid();
      chunkIndexRef.current = 0;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      recorderRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
          const idx = chunkIndexRef.current++;
          await saveChunk(recordingIdRef.current, idx, e.data).catch(console.error);
        }
      };

      recorder.onerror = (e) => {
        console.error('Recorder error:', e);
        setErrorMsg('Recording error. Your data up to this point may be recoverable.');
        setState('error');
      };

      startTimeRef.current = Date.now();
      setState('recording');
      startElapsedTimer();

      // Request a chunk every 2 s for crash resilience
      recorder.start(2000);
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setErrorMsg('Screen share permission denied. Click "Start recording" and allow screen access when prompted.');
      } else {
        setErrorMsg(e?.message || 'Could not start recording. Make sure you\'re on HTTPS or localhost.');
      }
      setState('error');
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const handlePause = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause();
      stopElapsedTimer();
      setState('paused');
    }
  };

  const handleResume = () => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume();
      startTimeRef.current = Date.now() - elapsed;
      startElapsedTimer();
      setState('recording');
    }
  };

  const handleStop = useCallback(async () => {
    stopElapsedTimer();

    const recorder = recorderRef.current;
    const stream = streamRef.current;

    // Stop stream tracks first so the browser chrome indicator goes away
    stream?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (!recorder || recorder.state === 'inactive') {
      navigate('/');
      return;
    }

    setState('saving');

    // Wait for the last ondataavailable to fire
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    // Reassemble chunks into one Blob (memory first, indexedDB fallback)
    let blobs = chunksRef.current;
    if (blobs.length === 0) {
      const chunks = await getChunks(recordingIdRef.current);
      blobs = chunks.map((c: any) => c.data as Blob);
    }

    if (blobs.length === 0) {
      setErrorMsg('No video data was captured. Try again.');
      setState('error');
      return;
    }

    const mimeType = blobs[0].type || 'video/webm';
    const fullBlob = new Blob(blobs, { type: mimeType });
    const durationMs = elapsed || Date.now() - startTimeRef.current;

    // Get video dimensions from the track settings
    const track = recorder.stream?.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    const w = (settings as any).width || 1280;
    const h = (settings as any).height || 720;

    const blobId = nanoid();
    await saveBlob(blobId, 'video', fullBlob);

    const projectName = pendingAnalysis?.title
      ? `${pendingAnalysis.title} – ${new Date().toLocaleDateString()}`
      : `Recording ${new Date().toLocaleString()}`;

    const project = defaultProject(recordingIdRef.current, projectName, w, h, durationMs, blobId);
    project.events = recordedEventsRef.current;
    if (pendingAnalysis) {
      project.analysis = pendingAnalysis;
    }

    await persistProject(project);
    navigate(`/editor/${project.id}`);
  }, [elapsed, navigate, pendingAnalysis, persistProject, stopElapsedTimer]);

  const mode = pendingAnalysis ? 'URL analysis' : 'Manual zoom';

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6 flex items-center gap-4">
        <Link to="/setup" className="text-text-muted hover:text-text transition-colors text-sm">
          ← Back to setup
        </Link>
        <div>
          <h1 className="text-2xl font-medium mb-1">Record</h1>
          <p className="text-text-muted text-sm">Share the tab or screen you want to capture</p>
        </div>
      </header>

      <div className="rounded-lg border border-line bg-surface-1 p-6 space-y-6">
        {/* Mode and analysis info */}
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wide">Mode</span>
            <div className="font-medium mt-0.5">{mode}</div>
            {pendingAnalysis && (
              <div className="text-sm text-text-muted mt-1">
                Page: <span className="text-text">{pendingAnalysis.title}</span>
              </div>
            )}
          </div>
          <div className="font-mono text-2xl tabular-nums text-text">
            {state === 'countdown' ? (
              <span className="text-focus text-4xl">{countdown}</span>
            ) : (
              <span className={state === 'recording' ? 'text-rec' : ''}>{formatTime(elapsed)}</span>
            )}
          </div>
        </div>

        {/* Mode explanation */}
        <div className="p-4 rounded-md bg-surface-2 border border-line text-sm text-text-muted">
          {pendingAnalysis ? (
            <p>
              <span className="text-ok font-medium">✓ Analysis ready.</span>{' '}
              Share the browser tab containing your page. Auto-zoom targets and page-info overlays will be generated in the editor.
            </p>
          ) : (
            <p>
              <span className="font-medium text-text">Manual zoom mode.</span>{' '}
              Record any screen or window. You'll add zoom segments manually in the editor. Cursor effects and page overlays are unavailable without analysis data.
            </p>
          )}
        </div>

        {/* Error */}
        {(state === 'error' || errorMsg) && (
          <div className="p-4 rounded-md bg-surface-2 border border-rec">
            <p className="text-sm text-rec">{errorMsg}</p>
            <button
              onClick={() => { setState('idle'); setErrorMsg(''); }}
              className="mt-2 text-sm text-text-muted hover:text-text underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Countdown overlay */}
        {state === 'countdown' && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="text-7xl font-bold text-focus tabular-nums">{countdown}</div>
            <p className="text-text-muted text-sm">Recording starts in…</p>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-3 flex-wrap">
          {(state === 'idle' || state === 'error') && (
            <button
              id="start-recording-btn"
              onClick={handleStartRecording}
              className="h-10 px-5 rounded-md bg-focus text-focus-ink font-medium text-sm"
            >
              Start recording
            </button>
          )}

          {state === 'requesting' && (
            <button disabled className="h-10 px-5 rounded-md bg-surface-2 border border-line text-sm opacity-60">
              Waiting for screen share…
            </button>
          )}

          {state === 'recording' && (
            <>
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-rec bg-surface-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-rec animate-pulse" />
                <span className="text-rec font-medium">Recording</span>
              </div>
              <button
                id="pause-recording-btn"
                onClick={handlePause}
                className="h-10 px-4 rounded-md border border-line text-sm hover:bg-surface-2 transition-colors"
              >
                Pause
              </button>
              <button
                id="stop-recording-btn"
                onClick={handleStop}
                className="h-10 px-4 rounded-md border border-rec text-rec text-sm hover:bg-surface-2 transition-colors"
              >
                Stop & save
              </button>
            </>
          )}

          {state === 'paused' && (
            <>
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-line bg-surface-2 text-sm text-text-muted">
                <span className="w-2 h-2 rounded-full bg-text-muted" />
                Paused
              </div>
              <button
                id="resume-recording-btn"
                onClick={handleResume}
                className="h-10 px-4 rounded-md bg-focus text-focus-ink text-sm font-medium"
              >
                Resume
              </button>
              <button
                id="stop-recording-btn"
                onClick={handleStop}
                className="h-10 px-4 rounded-md border border-rec text-rec text-sm hover:bg-surface-2 transition-colors"
              >
                Stop & save
              </button>
            </>
          )}

          {state === 'saving' && (
            <div className="flex items-center gap-3 h-10 px-4 text-sm text-text-muted">
              <span className="w-4 h-4 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
              Saving recording…
            </div>
          )}
        </div>

        {/* Keyboard hints */}
        {(state === 'recording' || state === 'paused') && (
          <p className="text-xs text-text-muted border-t border-line pt-4">
            Tip: click "Stop & save" when done. The editor opens automatically.
          </p>
        )}

        {state === 'idle' && (
          <p className="text-xs text-text-muted">
            You'll be asked to choose which screen, window, or tab to share. The browser's native share dialog will appear.
          </p>
        )}
      </div>
    </main>
  );
}
