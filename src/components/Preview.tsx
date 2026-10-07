import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { renderFrame, type DrawableImage } from '../engine/renderer';
import { formatTime, sourceTime, type Timeline } from '../engine/timeline';
import { RATIOS, type Placement, type Project, type VideoAsset } from '../engine/types';
import { Segmented } from './ui';

export interface PreviewController {
  seek(t: number): void;
  togglePlay(): void;
  pause(): void;
}

interface Props {
  project: Project;
  timeline: Timeline;
  video: VideoAsset | null;
  getImage: (id: string | null) => DrawableImage | null;
  /** Changes whenever fonts/images change so the frame is redrawn. */
  redrawKey: string;
  controllerRef: RefObject<PreviewController | null>;
  onPlacementChange: (placement: Placement) => void;
  onRatioChange: (ratio: Project['ratio']) => void;
}

export function Preview({ project, timeline, video, getImage, redrawKey, controllerRef, onPlacementChange, onRatioChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [safeZones, setSafeZones] = useState(false);

  // Mutable state read by the render loop.
  const live = useRef({ project, timeline, getImage, safeZones, video });
  live.current = { project, timeline, getImage, safeZones, video };
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const clockRef = useRef({ wall: 0, t: 0 });
  const dirtyRef = useRef(true);
  const lastUiUpdate = useRef(0);

  const clipOpts = useCallback(() => {
    const { project: p, video: v } = live.current;
    return { start: p.video.start, loop: p.video.loop, duration: v?.duration ?? 0 };
  }, []);

  const syncVideo = useCallback(
    (force: boolean) => {
      const el = videoRef.current;
      const v = live.current.video;
      if (!el || !v || el.readyState < 1) return;
      const expected = sourceTime(timeRef.current, clipOpts());
      if ((force || Math.abs(el.currentTime - expected) > 0.3) && !el.seeking) el.currentTime = expected;
      if (playingRef.current) {
        if (el.paused) void el.play().catch(() => undefined);
      } else if (!el.paused) {
        el.pause();
      }
    },
    [clipOpts],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { project: p, timeline: tl, getImage: gi, safeZones: sz } = live.current;
    const el = videoRef.current;
    const frame: DrawableImage | null =
      el && live.current.video && el.readyState >= 2 && el.videoWidth
        ? { source: el, width: el.videoWidth, height: el.videoHeight }
        : null;
    renderFrame(ctx, canvas.width, canvas.height, {
      project: p,
      timeline: tl,
      t: timeRef.current,
      getImage: gi,
      video: frame,
      safeZones: sz,
    });
  }, []);

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      if (playingRef.current) {
        const total = live.current.timeline.total;
        let t = clockRef.current.t + (now - clockRef.current.wall) / 1000;
        if (t >= total) {
          t = 0;
          clockRef.current = { wall: now, t: 0 };
          timeRef.current = 0;
          syncVideo(true);
        }
        timeRef.current = t;
        syncVideo(false);
        draw();
        if (now - lastUiUpdate.current > 90) {
          lastUiUpdate.current = now;
          setDisplayTime(t);
        }
      } else if (dirtyRef.current) {
        dirtyRef.current = false;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, syncVideo]);

  // Keep the canvas backing store matched to its on-screen size.
  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const resize = () => {
      const rect = frame.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const ratio = RATIOS[live.current.project.ratio];
      const w = Math.min(1080, Math.max(180, Math.round(rect.width * dpr)));
      const h = Math.round((w * ratio.h) / ratio.w);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [project.ratio]);

  // Anything visual changed → redraw.
  useEffect(() => {
    dirtyRef.current = true;
  }, [project, timeline, redrawKey, safeZones]);

  // Clamp the playhead if the edit got shorter.
  useEffect(() => {
    if (timeRef.current > timeline.total) {
      timeRef.current = 0;
      clockRef.current = { wall: performance.now(), t: 0 };
      setDisplayTime(0);
    }
  }, [timeline.total]);

  // Re-seek the clip when trim / loop / the clip itself changes.
  useEffect(() => {
    syncVideo(true);
    dirtyRef.current = true;
  }, [project.video.start, project.video.loop, video, syncVideo]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(live.current.timeline.total - 0.001, t));
      timeRef.current = clamped;
      clockRef.current = { wall: performance.now(), t: clamped };
      setDisplayTime(clamped);
      syncVideo(true);
      dirtyRef.current = true;
    },
    [syncVideo],
  );

  const setPlay = useCallback(
    (next: boolean) => {
      playingRef.current = next;
      clockRef.current = { wall: performance.now(), t: timeRef.current };
      setPlaying(next);
      syncVideo(true);
      dirtyRef.current = true;
    },
    [syncVideo],
  );

  const togglePlay = useCallback(() => setPlay(!playingRef.current), [setPlay]);

  useEffect(() => {
    controllerRef.current = { seek, togglePlay, pause: () => setPlay(false) };
  }, [controllerRef, seek, togglePlay, setPlay]);

  // Space bar toggles playback (unless typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  // Drag the cover + text block around.
  const drag = useRef<{ x: number; y: number; start: Placement; id: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, start: project.placement[project.ratio], id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.round(Math.min(0.92, Math.max(-0.1, v)) * 1000) / 1000;
    onPlacementChange({
      x: clamp(d.start.x + (e.clientX - d.x) / rect.width),
      y: clamp(d.start.y + (e.clientY - d.y) / rect.height),
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  // Scrubbing on the timeline bar.
  const scrubbing = useRef(false);
  const scrubTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * timeline.total);
  };

  const ratio = RATIOS[project.ratio];

  return (
    <div className="preview">
      <div className="preview-toolbar">
        <Segmented
          ariaLabel="Canvas ratio"
          value={project.ratio}
          onChange={onRatioChange}
          options={[
            { value: '9:16', label: '9:16' },
            { value: '3:4', label: '3:4' },
          ]}
        />
        <label className="chip-toggle">
          <input type="checkbox" checked={safeZones} onChange={(e) => setSafeZones(e.target.checked)} />
          <span>Safe zones</span>
        </label>
      </div>

      <div className="preview-stage">
        <div
          ref={frameRef}
          className="preview-frame"
          style={{ aspectRatio: `${ratio.w} / ${ratio.h}`, '--ar': String(ratio.w / ratio.h) } as CSSProperties}
        >
          <canvas
            ref={canvasRef}
            className="preview-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label="Video preview — drag to move the covers and text"
          />
          <span className="preview-hint">Drag to reposition</span>
        </div>
      </div>

      <div className="transport">
        <button type="button" className="play-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div
          className="scrubber"
          onPointerDown={(e) => {
            scrubbing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            scrubTo(e);
          }}
          onPointerMove={(e) => scrubbing.current && scrubTo(e)}
          onPointerUp={() => (scrubbing.current = false)}
          onPointerCancel={() => (scrubbing.current = false)}
          role="slider"
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={timeline.total}
          aria-valuenow={displayTime}
        >
          {timeline.segments.map((s) => (
            <span
              key={`${s.kind}-${s.index}`}
              className={`scrub-seg ${s.kind === 'end' ? 'is-end' : ''}`}
              style={{ flexGrow: s.end - s.start }}
            >
              {s.kind === 'end' ? 'End' : s.index + 1}
            </span>
          ))}
          <span className="scrub-head" style={{ left: `${(displayTime / Math.max(0.001, timeline.total)) * 100}%` }} />
        </div>
        <span className="time">
          {formatTime(displayTime)} <em>/ {formatTime(timeline.total)}</em>
        </span>
      </div>

      {video && (
        <video
          ref={videoRef}
          className="hidden-video"
          src={video.url}
          muted={!project.video.audio}
          playsInline
          preload="auto"
          onLoadedData={() => {
            syncVideo(true);
            dirtyRef.current = true;
          }}
          onSeeked={() => (dirtyRef.current = true)}
        />
      )}
    </div>
  );
}
