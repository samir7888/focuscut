import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../../stores/projectStore';
import { getBlob } from '../../storage/db';
import type { Project, ZoomSegment } from '../../types/project';
import {
  bakeCameraPath,
  sampleCameraPath,
  generateInteractiveZooms,
  type BakedCameraPath,
} from '../../engine/camera/baker';
import { getCursorAtTime } from '../../engine/cursor/cursorEngine';
import { drawCursor } from '../../engine/cursor/renderer';
import { nanoid } from 'nanoid';

type Tool = 'zoom' | 'cursor' | 'frame' | 'text' | 'page';

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const loadProject = useProjectStore((s) => s.loadProject);
  const updateProjectZooms = useProjectStore((s) => s.updateProjectZooms);

  const [project, setProject] = useState<Project | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTool, setActiveTool] = useState<Tool>('zoom');
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [showCustomCursor, setShowCustomCursor] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobUrlRef = useRef<string>('');
  const cameraPathRef = useRef<BakedCameraPath | null>(null);

  // Load project and video blob from IndexedDB
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const p = await loadProject(id!);
        if (cancelled) return;
        if (!p) {
          setError('Recording not found. It may have been deleted.');
          setLoading(false);
          return;
        }

        const blob = await getBlob(p.media.videoBlobId);
        if (cancelled) return;
        if (!blob) {
          setError('Video data not found. The recording may be corrupted.');
          setLoading(false);
          return;
        }

        // Sanitize legacy auto segments: convert any source: 'auto' with rect target to follow-cursor
        // so it dynamically tracks the cursor instead of jumping to arbitrary wrong fixed rectangles.
        let zooms = (p.edit?.zooms || []).map((seg) => {
          if (seg.source === 'auto' && seg.target.kind === 'rect') {
            return {
              ...seg,
              target: { kind: 'follow-cursor' as const },
              reason: seg.reason === 'focus' ? 'typing' : seg.reason,
            };
          }
          return seg;
        });

        // Filter out legacy dummy "link" segments that zoomed into empty bottom-right space
        zooms = zooms.filter((seg) => (seg as any).reason !== 'link');

        // Check for legacy touching segments that stayed zoomed without zooming out between elements
        const hasLegacyTouchingSegments = zooms.some((s, idx) => {
          if (idx === 0) return false;
          return s.startMs <= zooms[idx - 1].endMs + 400;
        });

        // If project has legacy touching segments (which made it zoom only once) or only 1 auto segment:
        // Regenerate proper separated interactive zooms for all buttons and input fields
        if (hasLegacyTouchingSegments || (zooms.length <= 1 && zooms.some((s) => s.source === 'auto'))) {
          zooms = generateInteractiveZooms(
            p.media.durationMs,
            p.media.width,
            p.media.height,
            p.analysis,
            p.edit?.zoomPreset || 'balanced',
          );
        }

        // Only persist if changes were made
        if (JSON.stringify(p.edit?.zooms || []) !== JSON.stringify(zooms)) {
          await updateProjectZooms(p.id, zooms);
        }

        const projectWithZooms: Project = {
          ...p,
          edit: {
            ...p.edit,
            zooms,
          },
        };

        if (zooms.length > 0 && !selectedZoomId) {
          setSelectedZoomId(zooms[0].id);
        }

        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setVideoUrl(url);
        setProject(projectWithZooms);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load recording.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = '';
      }
    };
  }, [id, loadProject, updateProjectZooms]);

  // Pre-bake camera path whenever zoom segments or video dimensions change
  useEffect(() => {
    if (!project || !project.media.width || !project.media.height) return;
    cameraPathRef.current = bakeCameraPath(
      project.media.durationMs,
      project.media.width,
      project.media.height,
      project.events || [],
      project.analysis,
      project.edit?.zoomPreset || 'balanced',
      project.edit.zooms,
      120, // 120 Hz simulation
    );
  }, [
    project?.edit.zooms,
    project?.media.width,
    project?.media.height,
    project?.media.durationMs,
    project?.events,
    project?.analysis,
    project?.edit?.zoomPreset,
  ]);

  const durationMs = project?.media.durationMs || 0;
  const progressPct = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;

  const handlePlayPause = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      const durationSec = durationMs / 1000;
      if (durationSec > 0 && video.currentTime >= durationSec - 0.05) {
        video.currentTime = 0;
      }
      try {
        await video.play();
        setPlaying(true);
      } catch (err) {
        console.error('Failed to play video:', err);
      }
    } else {
      video.pause();
      setPlaying(false);
    }
  }, [durationMs]);

  // Spacebar shortcut to play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        (e.target === document.body || (e.target as HTMLElement)?.tagName === 'MAIN')
      ) {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePlayPause]);

  // Canvas render loop with smooth spring camera zoom
  useEffect(() => {
    if (loading || !project || !videoUrl) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    function draw() {
      if (!video || !canvas || !ctx) return;
      const proj = project;
      if (!proj) return;

      const cw = canvas.offsetWidth;
      const ch = canvas.offsetHeight;
      if (cw > 0 && ch > 0) {
        const dpr = window.devicePixelRatio || 1;
        const targetW = Math.round(cw * dpr);
        const targetH = Math.round(ch * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        ctx.save();
        ctx.scale(dpr, dpr);

        // Fill canvas background
        ctx.fillStyle = '#121418';
        ctx.fillRect(0, 0, cw, ch);

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (vw > 0 && vh > 0) {
          // Framing box with 6% padding
          const padRatio = 0.06;
          const maxW = cw * (1 - padRatio * 2);
          const maxH = ch * (1 - padRatio * 2);
          const scale = Math.min(maxW / vw, maxH / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          const dx = (cw - dw) / 2;
          const dy = (ch - dh) / 2;
          const r = 12;

          // Sample smooth camera position from pre-baked critically damped spring path
          const curTimeMs = Math.round(video.currentTime * 1000);
          const camera = cameraPathRef.current
            ? sampleCameraPath(cameraPathRef.current, curTimeMs)
            : { cx: vw / 2, cy: vh / 2, scale: 1.0 };

          // Source crop rectangle inside video coordinates based on camera zoom
          const viewW = vw / camera.scale;
          const viewH = vh / camera.scale;
          const sx = Math.max(0, Math.min(vw - viewW, camera.cx - viewW / 2));
          const sy = Math.max(0, Math.min(vh - viewH, camera.cy - viewH / 2));

          // Drop shadow
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
          ctx.shadowBlur = 24;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 8;
          ctx.fillStyle = '#1c1f26';
          ctx.beginPath();
          ctx.roundRect(dx, dy, dw, dh, r);
          ctx.fill();
          ctx.restore();

          // Rounded frame with camera-zoomed video
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(dx, dy, dw, dh, r);
          ctx.clip();
          ctx.drawImage(video, sx, sy, viewW, viewH, dx, dy, dw, dh);
          ctx.restore();

          // Border around video frame
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(dx, dy, dw, dh, r);
          ctx.stroke();

          // Focus brackets around video frame
          const bLen = 22;
          const bW = 2;
          const bOff = 6;
          ctx.strokeStyle = '#F5C242';
          ctx.lineWidth = bW;
          // Top-left
          ctx.beginPath();
          ctx.moveTo(dx - bOff, dy - bOff + bLen);
          ctx.lineTo(dx - bOff, dy - bOff);
          ctx.lineTo(dx - bOff + bLen, dy - bOff);
          ctx.stroke();
          // Top-right
          ctx.beginPath();
          ctx.moveTo(dx + dw + bOff - bLen, dy - bOff);
          ctx.lineTo(dx + dw + bOff, dy - bOff);
          ctx.lineTo(dx + dw + bOff, dy - bOff + bLen);
          ctx.stroke();
          // Bottom-left
          ctx.beginPath();
          ctx.moveTo(dx - bOff, dy + dh + bOff - bLen);
          ctx.lineTo(dx - bOff, dy + dh + bOff);
          ctx.lineTo(dx - bOff + bLen, dy + dh + bOff);
          ctx.stroke();
          // Bottom-right
          ctx.beginPath();
          ctx.moveTo(dx + dw + bOff - bLen, dy + dh + bOff);
          ctx.lineTo(dx + dw + bOff, dy + dh + bOff);
          ctx.lineTo(dx + dw + bOff, dy + dh + bOff - bLen);
          ctx.stroke();

          // Get real-time cursor state
          const targets = cameraPathRef.current?.targets || [];
          const cursor = getCursorAtTime(
            curTimeMs,
            durationMs,
            vw,
            vh,
            proj.events || [],
            targets,
          );

          // Convert cursor video coordinates to screen coordinates
          const rawScreenX = dx + ((cursor.x - sx) / viewW) * dw;
          const rawScreenY = dy + ((cursor.y - sy) / viewH) * dh;

          // Keep the cursor in a visible place when zooming in!
          // Clamped strictly within the video frame with safe margin
          const screenX = Math.max(dx + 14, Math.min(dx + dw - 14, rawScreenX));
          const screenY = Math.max(dy + 14, Math.min(dy + dh - 14, rawScreenY));

          // Draw custom cursor on top of the video ONLY if enabled (avoids duplicate cursor)
          const hasCapturedPointerEvents = Boolean(
            proj.events &&
              proj.events.some((e) => e.type === 'pointer' || e.type === 'click'),
          );
          if (showCustomCursor || hasCapturedPointerEvents) {
            const cursorSize = (proj.edit?.cursor?.size || 1) * 1.15;
            drawCursor(ctx, cursor, screenX, screenY, cursorSize);
          }

          // Smooth Zoom badge overlay
          if (camera.scale > 1.08) {
            const actionKind =
              cursor.clickProgress >= 0
                ? 'CLICK'
                : cursor.interactiveKind === 'input' || cursor.style === 'ibeam'
                  ? 'INPUT'
                  : cursor.interactiveKind === 'button'
                    ? 'BUTTON'
                    : 'ZOOM';
            const badgeLabel = `🔍 ${camera.scale.toFixed(1)}x · ${actionKind}`;
            ctx.save();
            ctx.font = '600 11px system-ui, sans-serif';
            const textWidth = ctx.measureText(badgeLabel).width;
            const badgeW = textWidth + 16;
            const badgeH = 22;
            const bx = dx + dw - badgeW - 12;
            const by = dy + 12;

            ctx.fillStyle = 'rgba(18, 20, 24, 0.85)';
            ctx.beginPath();
            ctx.roundRect(bx, by, badgeW, badgeH, 6);
            ctx.fill();

            ctx.strokeStyle = '#F5C242';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#F5C242';
            ctx.fillText(badgeLabel, bx + 8, by + 15);
            ctx.restore();
          }
        } else {
          ctx.fillStyle = '#8A8F98';
          ctx.font = '13px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Loading recording…', cw / 2, ch / 2);
        }

        ctx.restore();
      }

      if (video && !video.paused) {
        setCurrentMs(Math.round(video.currentTime * 1000));
        const durationSec = (project?.media.durationMs || 0) / 1000;
        if (durationSec > 0 && video.currentTime >= durationSec) {
          video.pause();
          video.currentTime = durationSec;
          setPlaying(false);
        }
      }

      animId = requestAnimationFrame(draw);
    }

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [loading, project, videoUrl]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!durationMs || !videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetMs = pct * durationMs;
    videoRef.current.currentTime = targetMs / 1000;
    setCurrentMs(Math.round(targetMs));
  };

  const handleSuggestZooms = async () => {
    if (!project) return;
    const newZooms = generateInteractiveZooms(
      project.media.durationMs,
      project.media.width,
      project.media.height,
      project.analysis,
      project.edit?.zoomPreset || 'balanced',
    );
    const updated = {
      ...project,
      edit: {
        ...project.edit,
        zooms: newZooms,
      },
    };
    setProject(updated);
    if (newZooms.length > 0) setSelectedZoomId(newZooms[0].id);
    await updateProjectZooms(project.id, newZooms);
  };

  const handleAddZoomAtCurrent = async () => {
    if (!project) return;
    const startMs = Math.round(currentMs);
    const endMs = Math.min(durationMs, startMs + 3500);
    const vw = project.media.width || 1920;
    const vh = project.media.height || 1080;

    const newZoom: ZoomSegment = {
      id: nanoid(),
      startMs,
      endMs,
      scale: 1.8,
      target: {
        kind: 'rect',
        x: Math.round(vw * 0.2),
        y: Math.round(vh * 0.15),
        w: Math.round(vw * 0.6),
        h: Math.round(vh * 0.4),
      },
      source: 'manual',
      reason: 'focus',
    };

    const newZooms = [...project.edit.zooms, newZoom].sort((a, b) => a.startMs - b.startMs);
    const updated = {
      ...project,
      edit: {
        ...project.edit,
        zooms: newZooms,
      },
    };
    setProject(updated);
    setSelectedZoomId(newZoom.id);
    await updateProjectZooms(project.id, newZooms);
  };

  const handleUpdateZoom = async (updatedZoom: ZoomSegment) => {
    if (!project) return;
    const newZooms = project.edit.zooms.map((z) => (z.id === updatedZoom.id ? updatedZoom : z));
    const updated = {
      ...project,
      edit: {
        ...project.edit,
        zooms: newZooms,
      },
    };
    setProject(updated);
    await updateProjectZooms(project.id, newZooms);
  };

  const handleDeleteZoom = async (zoomId: string) => {
    if (!project) return;
    const newZooms = project.edit.zooms.filter((z) => z.id !== zoomId);
    const updated = {
      ...project,
      edit: {
        ...project.edit,
        zooms: newZooms,
      },
    };
    setProject(updated);
    if (selectedZoomId === zoomId) {
      setSelectedZoomId(newZooms.length > 0 ? newZooms[0].id : null);
    }
    await updateProjectZooms(project.id, newZooms);
  };

  const formatMs = (ms: number) => {
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    const ss = (s % 60).toFixed(3).padStart(6, '0');
    return `${String(m).padStart(2, '0')}:${ss}`;
  };

  const selectedZoom = project?.edit.zooms.find((z) => z.id === selectedZoomId);

  const tools: { key: Tool; label: string }[] = [
    { key: 'zoom', label: 'Zoom' },
    { key: 'cursor', label: 'Cursor' },
    { key: 'frame', label: 'Frame' },
    { key: 'text', label: 'Text' },
    { key: 'page', label: 'Page info' },
  ];

  return (
    <main className="h-screen flex flex-col overflow-hidden select-none">
      {/* Off-screen video element (must NOT be display:none so browser decodes frames) */}
      <video
        ref={videoRef}
        src={videoUrl || undefined}
        playsInline
        muted
        preload="auto"
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: 320,
          height: 240,
          opacity: 0,
          pointerEvents: 'none',
          visibility: 'visible',
        }}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentMs(Math.round(videoRef.current.currentTime * 1000));
          }
        }}
      />

      {/* Header */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-line bg-surface-1 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/library" className="text-text-muted hover:text-text text-sm transition-colors">
            ← Library
          </Link>
          <span className="text-line">|</span>
          <span className="text-sm truncate max-w-48">{project?.name || 'Loading…'}</span>
        </div>
        <div className="flex gap-2">
          <button
            className="h-8 px-3 rounded-md border border-line text-sm hover:bg-surface-2 transition-colors opacity-50 cursor-not-allowed"
            disabled
          >
            Undo
          </button>
          <button
            className="h-8 px-3 rounded-md border border-line text-sm hover:bg-surface-2 transition-colors opacity-50 cursor-not-allowed"
            disabled
          >
            Redo
          </button>
          <button
            className="h-8 px-3 rounded-md bg-focus text-focus-ink text-sm font-medium hover:brightness-110 transition-all opacity-50 cursor-not-allowed"
            disabled
            title="Export — coming in Phase 7"
          >
            Export
          </button>
        </div>
      </header>

      {/* Loading / Error state */}
      {(loading || error) && (
        <div className="flex-1 flex items-center justify-center">
          {loading && (
            <div className="flex flex-col items-center gap-3 text-text-muted">
              <span className="w-6 h-6 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Loading recording…</span>
            </div>
          )}
          {error && (
            <div className="text-center space-y-4">
              <p className="text-rec">{error}</p>
              <button onClick={() => navigate('/library')} className="text-sm text-focus underline">
                Back to library
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main editor area */}
      {!loading && !error && project && (
        <>
          <div className="flex-1 grid grid-cols-[200px_1fr_280px] overflow-hidden">
            {/* Tools sidebar */}
            <aside className="border-r border-line bg-surface-1 p-3 flex flex-col gap-1 overflow-y-auto">
              <div className="text-xs font-medium mb-2 text-text-muted uppercase tracking-wide">
                Tools
              </div>
              {tools.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTool(key)}
                  className={`px-3 py-2 rounded-md text-sm text-left transition-colors flex items-center justify-between ${
                    activeTool === key
                      ? 'bg-focus text-focus-ink font-medium'
                      : 'hover:bg-surface-2 text-text'
                  }`}
                >
                  <span>{label}</span>
                  {key === 'zoom' && project.edit.zooms.length > 0 && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${activeTool === 'zoom' ? 'bg-focus-ink/20 text-focus-ink' : 'bg-surface-2 text-text-muted'}`}
                    >
                      {project.edit.zooms.length}
                    </span>
                  )}
                </button>
              ))}
            </aside>

            {/* Canvas preview */}
            <section
              className="bg-surface-0 flex flex-col items-center justify-center relative cursor-pointer group"
              onClick={handlePlayPause}
            >
              <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />

              {/* Play/pause overlay button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlayPause();
                }}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 h-9 px-4 rounded-md bg-surface-1/90 backdrop-blur-sm border border-line text-sm hover:bg-surface-2 transition-all shadow-md group-hover:scale-105"
              >
                <span>{playing ? '⏸' : '▶'}</span>
                <span>{playing ? 'Pause' : 'Play'}</span>
              </button>
            </section>

            {/* Inspector */}
            <aside className="border-l border-line bg-surface-1 p-4 overflow-y-auto">
              <div className="text-xs font-medium mb-3 text-text-muted uppercase tracking-wide">
                Inspector
              </div>

              {activeTool === 'zoom' && (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <button
                      onClick={handleSuggestZooms}
                      className="flex-1 h-8 rounded-md bg-focus text-focus-ink text-xs font-semibold hover:brightness-110 transition-all shadow-sm"
                      title="Automatically calculate smooth zoom segments based on page sections"
                    >
                      ✨ Auto Zooms
                    </button>
                    <button
                      onClick={handleAddZoomAtCurrent}
                      className="h-8 px-3 rounded-md border border-line bg-surface-2 text-xs hover:bg-surface-0 transition-colors"
                      title="Add zoom segment at current playhead"
                    >
                      + Add
                    </button>
                  </div>

                  {project.analysis && (
                    <div className="p-2.5 rounded-md bg-surface-2 border border-line text-xs">
                      <span className="text-text-muted">Targeting: </span>
                      <span className="font-medium text-text">{project.analysis.title}</span>
                    </div>
                  )}

                  {/* Zoom segments list */}
                  <div>
                    <div className="text-xs font-medium text-text-muted mb-2 flex justify-between">
                      <span>Zoom Segments ({project.edit.zooms.length})</span>
                      <span className="text-[10px] text-text-muted">Click to select</span>
                    </div>

                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {project.edit.zooms.map((seg, idx) => {
                        const isSel = seg.id === selectedZoomId;
                        const isCur = currentMs >= seg.startMs && currentMs <= seg.endMs;
                        return (
                          <div
                            key={seg.id}
                            onClick={() => {
                              setSelectedZoomId(seg.id);
                              if (videoRef.current) {
                                videoRef.current.currentTime = seg.startMs / 1000;
                                setCurrentMs(seg.startMs);
                              }
                            }}
                            className={`p-2 rounded-md text-xs cursor-pointer border transition-all flex items-center justify-between ${
                              isSel
                                ? 'border-focus bg-focus/15 text-text font-medium'
                                : isCur
                                  ? 'border-focus/50 bg-surface-2 text-text'
                                  : 'border-line bg-surface-2/60 hover:bg-surface-2 text-text-muted hover:text-text'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full ${isCur ? 'bg-focus animate-pulse' : 'bg-line'}`}
                              />
                              <span>
                                #{idx + 1} · {seg.scale.toFixed(1)}x
                              </span>
                            </div>
                            <span className="font-mono text-[10px]">
                              {(seg.startMs / 1000).toFixed(1)}s - {(seg.endMs / 1000).toFixed(1)}s
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Selected Zoom Editor */}
                  {selectedZoom && (
                    <div className="border-t border-line pt-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text">Edit Zoom Segment</span>
                        <button
                          onClick={() => handleDeleteZoom(selectedZoom.id)}
                          className="text-[11px] text-rec hover:underline"
                        >
                          Delete
                        </button>
                      </div>

                      {/* Scale Slider */}
                      <div>
                        <div className="flex justify-between text-xs text-text-muted mb-1">
                          <span>Zoom Scale</span>
                          <span className="font-mono text-focus font-bold">
                            {selectedZoom.scale.toFixed(2)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="1.2"
                          max="2.5"
                          step="0.05"
                          value={selectedZoom.scale}
                          onChange={(e) =>
                            handleUpdateZoom({
                              ...selectedZoom,
                              scale: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-focus cursor-pointer"
                        />
                      </div>

                      {/* Target Presets */}
                      <div>
                        <span className="text-xs text-text-muted block mb-1.5">Focus Target</span>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            {
                              label: 'Top (Hero)',
                              rect: {
                                x: Math.round((project.media.width || 1920) * 0.22),
                                y: Math.round((project.media.height || 1080) * 0.12),
                                w: Math.round((project.media.width || 1920) * 0.56),
                                h: Math.round((project.media.height || 1080) * 0.32),
                              },
                            },
                            {
                              label: 'Center (Body)',
                              rect: {
                                x: Math.round((project.media.width || 1920) * 0.18),
                                y: Math.round((project.media.height || 1080) * 0.3),
                                w: Math.round((project.media.width || 1920) * 0.64),
                                h: Math.round((project.media.height || 1080) * 0.42),
                              },
                            },
                            {
                              label: 'Bottom (CTA)',
                              rect: {
                                x: Math.round((project.media.width || 1920) * 0.45),
                                y: Math.round((project.media.height || 1080) * 0.5),
                                w: Math.round((project.media.width || 1920) * 0.45),
                                h: Math.round((project.media.height || 1080) * 0.38),
                              },
                            },
                            {
                              label: 'Left (Nav)',
                              rect: {
                                x: Math.round((project.media.width || 1920) * 0.05),
                                y: Math.round((project.media.height || 1080) * 0.15),
                                w: Math.round((project.media.width || 1920) * 0.4),
                                h: Math.round((project.media.height || 1080) * 0.5),
                              },
                            },
                          ].map(({ label, rect }) => (
                            <button
                              key={label}
                              onClick={() =>
                                handleUpdateZoom({
                                  ...selectedZoom,
                                  target: { kind: 'rect', ...rect },
                                })
                              }
                              className="px-2 py-1.5 rounded bg-surface-2 hover:bg-surface-0 border border-line text-[11px] text-text text-left transition-colors truncate"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Jump to segment */}
                      <button
                        onClick={() => {
                          if (videoRef.current) {
                            videoRef.current.currentTime = selectedZoom.startMs / 1000;
                            setCurrentMs(selectedZoom.startMs);
                          }
                        }}
                        className="w-full h-7 rounded border border-line text-xs hover:bg-surface-2 transition-colors text-text-muted hover:text-text"
                      >
                        Seek playhead here
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTool === 'page' && project.analysis && (
                <div className="space-y-3">
                  <div className="p-3 rounded-md bg-surface-2 border border-line">
                    <div className="text-xs text-text-muted mb-1">Title</div>
                    <div className="text-sm font-medium">{project.analysis.title}</div>
                  </div>
                  {project.analysis.brand.colors.length > 0 && (
                    <div className="p-3 rounded-md bg-surface-2 border border-line">
                      <div className="text-xs text-text-muted mb-2">Brand colors</div>
                      <div className="flex gap-2 flex-wrap">
                        {project.analysis.brand.colors.map((c, i) => (
                          <div
                            key={i}
                            className="w-7 h-7 rounded border border-line"
                            style={{ background: c }}
                            title={c}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {project.analysis.features.length > 0 && (
                    <div className="p-3 rounded-md bg-surface-2 border border-line">
                      <div className="text-xs text-text-muted mb-2">Features</div>
                      <ul className="space-y-1 text-sm">
                        {project.analysis.features.slice(0, 5).map((f, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-focus">•</span>
                            <span>{f.title}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {activeTool === 'page' && !project.analysis && (
                <p className="text-sm text-text-muted">
                  No page analysis for this recording. Re-record with URL analysis mode.
                </p>
              )}

              {activeTool === 'frame' && (
                <div className="space-y-3 text-sm text-text-muted">
                  <div>
                    <div className="text-xs uppercase tracking-wide mb-1">Background</div>
                    <div className="p-2 rounded-md bg-surface-2 border border-line">
                      Solid · #121418
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide mb-1">Padding</div>
                    <div className="p-2 rounded-md bg-surface-2 border border-line">6%</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide mb-1">Mockup</div>
                    <div className="p-2 rounded-md bg-surface-2 border border-line">
                      Minimal focus brackets
                    </div>
                  </div>
                </div>
              )}

              {activeTool === 'cursor' && (
                <div className="space-y-4 text-xs">
                  <div>
                    <span className="font-medium text-text block mb-1">Cursor Mode</span>
                    <div className="p-2.5 rounded-md bg-surface-2 border border-line text-text-muted space-y-1">
                      <div className="flex items-center gap-1.5 text-text font-medium">
                        <span className="text-focus">✓</span>
                        <span>Auto-Contextual</span>
                      </div>
                      <p className="text-[11px]">
                        Switches automatically to I-Beam on input fields and Pointer Hand on buttons & links.
                      </p>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-text-muted mb-1">
                      <span>Cursor Size</span>
                      <span className="font-mono text-focus font-bold">
                        {(project.edit?.cursor?.size || 1).toFixed(1)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.8"
                      max="2.0"
                      step="0.1"
                      value={project.edit?.cursor?.size || 1}
                      onChange={(e) => {
                        const newSize = parseFloat(e.target.value);
                        setProject({
                          ...project,
                          edit: {
                            ...project.edit,
                            cursor: {
                              ...project.edit.cursor,
                              size: newSize,
                            },
                          },
                        });
                      }}
                      className="w-full accent-focus cursor-pointer"
                    />
                  </div>

                  <div>
                    <span className="font-medium text-text block mb-1.5">Zoom Tracking</span>
                    <div className="p-2.5 rounded-md bg-surface-2 border border-line space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-ok" />
                        <span className="text-text font-medium">Cursor-Centric Zoom</span>
                      </div>
                      <p className="text-[11px] text-text-muted">
                        Camera automatically tracks cursor motion and keeps it visible within the focal area.
                      </p>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-text">Synthetic Cursor Overlay</span>
                      <button
                        onClick={() => setShowCustomCursor(!showCustomCursor)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          showCustomCursor ? 'bg-focus' : 'bg-surface-2 border border-line'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full transition-transform ${
                            showCustomCursor ? 'translate-x-4 bg-focus-ink' : 'translate-x-1 bg-text-muted'
                          }`}
                        />
                      </button>
                    </div>
                    <p className="text-[11px] text-text-muted">
                      {showCustomCursor
                        ? 'Custom animated cursor is enabled. Turn OFF if your recorded video already has a cursor.'
                        : 'Single cursor active (using recorded cursor in video). Turn ON only if your video has no cursor.'}
                    </p>
                  </div>
                </div>
              )}

              {activeTool === 'text' && (
                <p className="text-sm text-text-muted">Coming in the next phase.</p>
              )}
            </aside>
          </div>

          {/* Timeline */}
          <footer
            className="border-t border-line bg-surface-1 flex-shrink-0"
            style={{ height: '160px' }}
          >
            <div className="h-10 flex items-center gap-3 px-4 border-b border-line">
              <button
                onClick={handlePlayPause}
                className="w-8 h-8 rounded-md border border-line flex items-center justify-center text-sm hover:bg-surface-2 transition-colors"
                title={playing ? 'Pause (Space)' : 'Play (Space)'}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <span className="font-mono text-xs tabular-nums">{formatMs(currentMs)}</span>
              <span className="text-text-muted text-xs">/</span>
              <span className="font-mono text-xs tabular-nums text-text-muted">
                {formatMs(durationMs)}
              </span>
              <div
                className="flex-1 h-2 rounded-full bg-surface-2 cursor-pointer relative"
                onClick={handleSeek}
              >
                <div
                  className="absolute left-0 top-0 h-full bg-focus rounded-full transition-none pointer-events-none"
                  style={{ width: `${Math.min(100, progressPct)}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-focus border-2 border-surface-1 pointer-events-none transition-none shadow-sm"
                  style={{ left: `calc(${Math.min(100, progressPct)}% - 7px)` }}
                />
              </div>
            </div>

            {/* Interactive Timeline Lanes */}
            <div className="px-4 py-2 space-y-1.5">
              {/* Zoom lane */}
              <div className="grid grid-cols-[64px_1fr] gap-2 text-xs items-center">
                <span className="text-text-muted flex items-center gap-1 font-medium">
                  <span>Zoom</span>
                </span>
                <div
                  className="relative h-6 rounded bg-surface-2/80 border border-line overflow-hidden cursor-pointer"
                  onClick={handleSeek}
                >
                  {project.edit.zooms.map((seg) => {
                    const leftPct = durationMs > 0 ? (seg.startMs / durationMs) * 100 : 0;
                    const widthPct =
                      durationMs > 0
                        ? Math.max(3, ((seg.endMs - seg.startMs) / durationMs) * 100)
                        : 0;
                    const isSel = seg.id === selectedZoomId;
                    const isCur = currentMs >= seg.startMs && currentMs <= seg.endMs;

                    return (
                      <div
                        key={seg.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedZoomId(seg.id);
                          setActiveTool('zoom');
                          if (videoRef.current) {
                            videoRef.current.currentTime = seg.startMs / 1000;
                            setCurrentMs(seg.startMs);
                          }
                        }}
                        className={`absolute top-0.5 bottom-0.5 rounded px-1.5 flex items-center justify-between text-[10px] cursor-pointer transition-all ${
                          isSel
                            ? 'bg-focus text-focus-ink font-bold shadow-md z-10 ring-1 ring-white/50'
                            : isCur
                              ? 'bg-focus/90 text-focus-ink font-semibold'
                              : 'bg-focus/50 hover:bg-focus/70 text-text'
                        }`}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        title={`Zoom ${seg.scale.toFixed(1)}x (${formatMs(seg.startMs)} - ${formatMs(seg.endMs)})`}
                      >
                        <span className="truncate">
                          🔍 {seg.scale.toFixed(1)}x {seg.reason ? `· ${seg.reason}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Overlay lane */}
              <div className="grid grid-cols-[64px_1fr] gap-2 text-xs items-center">
                <span className="text-text-muted flex items-center">Overlay</span>
                <div className="h-5 rounded-sm bg-surface-2 border border-line" />
              </div>

              {/* Video lane */}
              <div className="grid grid-cols-[64px_1fr] gap-2 text-xs items-center">
                <span className="text-text-muted flex items-center">Video</span>
                <div
                  className="h-5 rounded-sm border border-line overflow-hidden relative cursor-pointer"
                  onClick={handleSeek}
                  style={{
                    background: 'linear-gradient(90deg, #1A2A1A 0%, #2A3A2A 50%, #1A2A1A 100%)',
                  }}
                >
                  <div
                    className="absolute left-0 top-0 bottom-0 bg-white/10 pointer-events-none"
                    style={{ width: `${Math.min(100, progressPct)}%` }}
                  />
                </div>
              </div>
            </div>
          </footer>
        </>
      )}
    </main>
  );
}
