import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { BufferPlayer } from '../engine/bufferPlayer';
import { Compositor } from '../engine/compositor';
import type { Lut } from '../engine/luts';
import type { DrawableImage } from '../engine/renderer';
import { sourceTime, type Timeline } from '../engine/timeline';
import type { Placement, Project, VideoAsset } from '../engine/types';
import { Player, type PlayerController, type PlayerSegment } from './Player';

export type PreviewController = PlayerController;

interface Props {
  project: Project;
  timeline: Timeline;
  video: VideoAsset | null;
  getImage: (id: string | null) => DrawableImage | null;
  getLut: (key: string) => Lut | null;
  /** Changes whenever fonts/images change so the frame is redrawn. */
  redrawKey: string;
  controllerRef: RefObject<PreviewController | null>;
  onPlacementChange: (placement: Placement) => void;
  onRatioChange: (ratio: Project['ratio']) => void;
  active?: boolean;
  /** The clip's cleaned-up sound, played instead of the clip's own when set. */
  enhancedAudio?: AudioBuffer | null;
}

/** Preview for the cover-crate mode: background clip + covers + text. */
export function Preview({
  project,
  timeline,
  video,
  getImage,
  getLut,
  redrawKey,
  controllerRef,
  onPlacementChange,
  onRatioChange,
  active,
  enhancedAudio = null,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const playerRef = useRef<BufferPlayer | null>(null);
  const live = useRef({ project, video, enhancedAudio });
  live.current = { project, video, enhancedAudio };

  useEffect(
    () => () => {
      compositorRef.current?.dispose();
      playerRef.current?.dispose();
    },
    [],
  );

  const sync = useCallback((t: number, playing: boolean, force: boolean) => {
    const el = videoRef.current;
    const { project: p, video: v, enhancedAudio: buffer } = live.current;
    if (!el || !v || el.readyState < 1) {
      playerRef.current?.stop();
      return;
    }
    const expected = sourceTime(t, { start: p.video.start, loop: p.video.loop, duration: v.duration });
    if ((force || Math.abs(el.currentTime - expected) > 0.3) && !el.seeking) el.currentTime = expected;
    // The enhanced sound plays from a buffer while the clip itself stays muted.
    const enhanced = p.video.audio ? buffer : null;
    el.muted = !p.video.audio || !!enhanced;
    if (enhanced) {
      const player = (playerRef.current ??= new BufferPlayer());
      player.setBuffer(enhanced);
      const ended = !p.video.loop && t > Math.max(0, v.duration - p.video.start);
      const loop = p.video.loop ? { start: p.video.start, end: Math.min(v.duration, enhanced.duration) } : null;
      player.sync(expected, playing && !ended, force, 1, loop);
    } else {
      playerRef.current?.stop();
    }
    if (playing) {
      if (el.paused) void el.play().catch(() => undefined);
    } else if (!el.paused) {
      el.pause();
    }
  }, []);

  const render = (ctx: CanvasRenderingContext2D, t: number, safeZones: boolean) => {
    compositorRef.current ??= new Compositor(ctx);
    const el = videoRef.current;
    const frame: DrawableImage | null =
      el && video && el.readyState >= 2 && el.videoWidth ? { source: el, width: el.videoWidth, height: el.videoHeight } : null;
    compositorRef.current.draw({ project, timeline, t, getImage, getLut, video: frame, safeZones });
  };

  // Re-seek the clip when trim / loop / the clip itself / its sound changes.
  useEffect(() => {
    controllerRef.current?.resync();
  }, [project.video.start, project.video.loop, project.video.audio, video, enhancedAudio, controllerRef]);

  // Drag the cover + text block around.
  const dragStart = useRef<Placement | null>(null);
  const onDrag = (phase: 'start' | 'move', dx: number, dy: number) => {
    if (phase === 'start') {
      dragStart.current = project.placement[project.ratio];
      return;
    }
    const start = dragStart.current;
    if (!start) return;
    const clamp = (v: number) => Math.round(Math.min(0.92, Math.max(-0.1, v)) * 1000) / 1000;
    onPlacementChange({ x: clamp(start.x + dx), y: clamp(start.y + dy) });
  };

  const segments = useMemo<PlayerSegment[]>(
    () =>
      timeline.segments.map((s) => ({
        key: `${s.kind}-${s.index}`,
        label: s.kind === 'end' ? 'End' : String(s.index + 1),
        start: s.start,
        end: s.end,
        accent: s.kind === 'end',
      })),
    [timeline],
  );

  return (
    <Player
      ratio={project.ratio}
      duration={timeline.total}
      segments={segments}
      controllerRef={controllerRef}
      onRatioChange={onRatioChange}
      render={render}
      sync={sync}
      onDrag={onDrag}
      dragHint="Drag to reposition"
      ariaLabel="Video preview — drag to move the covers and text"
      redrawKey={[project, timeline, redrawKey]}
      active={active}
    >
      {video && (
        <video
          ref={videoRef}
          className="hidden-video"
          src={video.url}
          muted={!project.video.audio || !!enhancedAudio}
          playsInline
          preload="auto"
          onLoadedData={() => controllerRef.current?.resync()}
          onSeeked={() => controllerRef.current?.invalidate()}
        />
      )}
    </Player>
  );
}
