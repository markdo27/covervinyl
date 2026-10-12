import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { formatTime } from '../engine/timeline';
import { RATIOS, type Ratio } from '../engine/types';
import { Segmented } from './ui';

export interface PlayerController {
  seek(t: number): void;
  togglePlay(): void;
  pause(): void;
  /** Redraw the current frame (e.g. a video finished seeking). */
  invalidate(): void;
  /** Force media back in step with the playhead, then redraw. */
  resync(): void;
}

export interface PlayerSegment {
  key: string;
  label: string;
  start: number;
  end: number;
  accent?: boolean;
}

interface Props {
  ratio: Ratio;
  duration: number;
  segments: PlayerSegment[];
  controllerRef: RefObject<PlayerController | null>;
  onRatioChange: (ratio: Ratio) => void;
  /** Draws the frame at time t; the context is sized to the canvas. */
  render: (ctx: CanvasRenderingContext2D, t: number, safeZones: boolean) => void;
  /** Keeps media elements in step with the playhead (`force` after seeks / play / pause). */
  sync?: (t: number, playing: boolean, force: boolean) => void;
  /** Canvas drag; dx/dy are fractions of the canvas size since the drag started. */
  onDrag?: (phase: 'start' | 'move', dx: number, dy: number) => void;
  dragHint?: string;
  ariaLabel: string;
  /** Anything visual that changes this value triggers a redraw. */
  redrawKey: unknown;
  /** Paused and idle while hidden (e.g. the other mode is showing). */
  active?: boolean;
  children?: ReactNode;
}

/**
 * Generic preview player: keeps the canvas matched to its on-screen size,
 * runs the playback clock and render loop, and provides the transport,
 * scrubber, ratio switch and safe-zone toggle.
 */
export function Player({
  ratio,
  duration,
  segments,
  controllerRef,
  onRatioChange,
  render,
  sync,
  onDrag,
  dragHint,
  ariaLabel,
  redrawKey,
  active = true,
  children,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [safeZones, setSafeZones] = useState(false);

  // Mutable state read by the render loop.
  const live = useRef({ render, sync, duration, safeZones, ratio, active });
  live.current = { render, sync, duration, safeZones, ratio, active };
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const clockRef = useRef({ wall: 0, t: 0 });
  const dirtyRef = useRef(true);
  const lastUiUpdate = useRef(0);

  const syncMedia = useCallback((force: boolean) => {
    live.current.sync?.(timeRef.current, playingRef.current, force);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    live.current.render(ctx, timeRef.current, live.current.safeZones);
  }, []);

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      if (playingRef.current) {
        const total = live.current.duration;
        let t = clockRef.current.t + (now - clockRef.current.wall) / 1000;
        if (t >= total) {
          t = 0;
          clockRef.current = { wall: now, t: 0 };
          timeRef.current = 0;
          syncMedia(true);
        }
        timeRef.current = t;
        syncMedia(false);
        draw();
        if (now - lastUiUpdate.current > 90) {
          lastUiUpdate.current = now;
          setDisplayTime(t);
        }
      } else if (dirtyRef.current && live.current.active) {
        dirtyRef.current = false;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, syncMedia]);

  // Keep the canvas backing store matched to its on-screen size.
  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const resize = () => {
      const rect = frame.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = RATIOS[live.current.ratio];
      const w = Math.min(1080, Math.max(180, Math.round(rect.width * dpr)));
      const h = Math.round((w * r.h) / r.w);
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
  }, [ratio]);

  // Anything visual changed → redraw.
  useEffect(() => {
    dirtyRef.current = true;
  }, [redrawKey, safeZones, active]);

  // Clamp the playhead if the edit got shorter.
  useEffect(() => {
    if (timeRef.current > duration) {
      timeRef.current = 0;
      clockRef.current = { wall: performance.now(), t: 0 };
      setDisplayTime(0);
      syncMedia(true);
    }
  }, [duration, syncMedia]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(live.current.duration - 0.001, t));
      timeRef.current = clamped;
      clockRef.current = { wall: performance.now(), t: clamped };
      setDisplayTime(clamped);
      syncMedia(true);
      dirtyRef.current = true;
    },
    [syncMedia],
  );

  const setPlay = useCallback(
    (next: boolean) => {
      playingRef.current = next;
      clockRef.current = { wall: performance.now(), t: timeRef.current };
      setPlaying(next);
      syncMedia(true);
      dirtyRef.current = true;
    },
    [syncMedia],
  );

  const togglePlay = useCallback(() => setPlay(!playingRef.current), [setPlay]);

  useEffect(() => {
    controllerRef.current = {
      seek,
      togglePlay,
      pause: () => setPlay(false),
      invalidate: () => {
        dirtyRef.current = true;
      },
      resync: () => {
        syncMedia(true);
        dirtyRef.current = true;
      },
    };
  }, [controllerRef, seek, togglePlay, setPlay, syncMedia]);

  // Pause when hidden.
  useEffect(() => {
    if (!active && playingRef.current) setPlay(false);
  }, [active, setPlay]);

  // Space bar toggles playback (unless typing).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, active]);

  // Canvas drag.
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!onDrag) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    onDrag('start', 0, 0);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !onDrag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onDrag('move', (e.clientX - d.x) / rect.width, (e.clientY - d.y) / rect.height);
  };
  const endDrag = () => {
    drag.current = null;
  };

  // Scrubbing on the timeline bar.
  const scrubbing = useRef(false);
  const scrubTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };

  const r = RATIOS[ratio];

  return (
    <div className="preview">
      <div className="preview-toolbar">
        <Segmented
          ariaLabel="Canvas ratio"
          value={ratio}
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
          style={{ aspectRatio: `${r.w} / ${r.h}`, '--ar': String(r.w / r.h) } as CSSProperties}
        >
          <canvas
            ref={canvasRef}
            className={`preview-canvas ${onDrag ? 'is-draggable' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label={ariaLabel}
          />
          {dragHint && <span className="preview-hint">{dragHint}</span>}
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
          aria-valuemax={duration}
          aria-valuenow={displayTime}
        >
          {segments.map((s) => (
            <span key={s.key} className={`scrub-seg ${s.accent ? 'is-end' : ''}`} style={{ flexGrow: s.end - s.start }}>
              {s.label}
            </span>
          ))}
          <span className="scrub-head" style={{ left: `${(displayTime / Math.max(0.001, duration)) * 100}%` }} />
        </div>
        <span className="time">
          {formatTime(displayTime)} <em>/ {formatTime(duration)}</em>
        </span>
      </div>

      {children}
    </div>
  );
}
