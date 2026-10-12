import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { Compositor } from '../../engine/compositor';
import type { Lut } from '../../engine/luts';
import type { OverlayAsset } from '../../engine/overlay';
import type { MediaAsset, ReelProject, ReelTimeline } from '../../engine/reel';
import { ReelMedia, type MusicAsset } from '../../engine/reelMedia';
import { reelFrame } from '../../engine/reelRenderer';
import type { Ratio } from '../../engine/types';
import { Player, type PlayerController, type PlayerSegment } from '../Player';

interface Props {
  project: ReelProject;
  timeline: ReelTimeline;
  media: MediaAsset[];
  getMedia: (id: string | null) => MediaAsset | null;
  overlay: OverlayAsset | null;
  music: MusicAsset | null;
  getLut: (key: string) => Lut | null;
  controllerRef: RefObject<PlayerController | null>;
  onOverlayMove: (x: number, y: number) => void;
  onRatioChange: (ratio: Ratio) => void;
  redrawKey: unknown;
  active: boolean;
}

export function ReelPreview(props: Props) {
  const { project, timeline, controllerRef } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<ReelMedia | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const media = new ReelMedia(hostRef.current ?? document.body);
    media.onFrame = () => controllerRef.current?.invalidate();
    mediaRef.current = media;
    return () => {
      media.dispose();
      mediaRef.current = null;
      compositorRef.current?.dispose();
    };
  }, [controllerRef]);

  useEffect(() => {
    mediaRef.current?.setAssets(props.media, props.overlay, props.music, props.getMedia);
    controllerRef.current?.resync();
  }, [props.media, props.overlay, props.music, props.getMedia, controllerRef]);

  useEffect(() => {
    if (!props.active) mediaRef.current?.pauseAll();
  }, [props.active]);

  const sync = useCallback((t: number, playing: boolean, force: boolean) => {
    const { project: p, timeline: tl } = live.current;
    mediaRef.current?.sync(p, tl, t, playing, force);
  }, []);

  const render = (ctx: CanvasRenderingContext2D, t: number, safeZones: boolean) => {
    compositorRef.current ??= new Compositor(ctx);
    const media = mediaRef.current;
    compositorRef.current.drawLayers(
      reelFrame(
        {
          project,
          timeline,
          t,
          getMedia: props.getMedia,
          videoFrame: (i) => media?.videoFrame(i) ?? null,
          overlay: props.overlay,
          overlayVideoFrame: media?.overlayFrame() ?? null,
        },
        props.getLut,
        safeZones,
      ),
    );
  };

  // Drag the overlay around.
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const onDrag = (phase: 'start' | 'move', dx: number, dy: number) => {
    if (phase === 'start') {
      dragStart.current = { x: project.overlay.x, y: project.overlay.y };
      return;
    }
    const start = dragStart.current;
    if (!start) return;
    const clamp = (v: number) => Math.round(Math.min(1.1, Math.max(-0.1, v)) * 1000) / 1000;
    props.onOverlayMove(clamp(start.x + dx), clamp(start.y + dy));
  };

  const segments = useMemo<PlayerSegment[]>(
    () =>
      project.items.map((item, i) => ({
        key: item.id,
        label: String(i + 1),
        start: timeline.starts[i],
        end: timeline.starts[i] + item.duration,
      })),
    [project.items, timeline],
  );

  return (
    <Player
      ratio={project.ratio}
      duration={timeline.total}
      segments={segments}
      controllerRef={controllerRef}
      onRatioChange={props.onRatioChange}
      render={render}
      sync={sync}
      onDrag={project.overlay.visible ? onDrag : undefined}
      dragHint="Drag to move the animation"
      ariaLabel="Reel preview — drag to move the animation"
      redrawKey={[project, timeline, props.redrawKey]}
      active={props.active}
    >
      <div ref={hostRef} className="offscreen-media" aria-hidden />
    </Player>
  );
}
