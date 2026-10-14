import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { Compositor } from '../../engine/compositor';
import { stripMarkup } from '../../engine/markup';
import { NEW, type FlipProject, type FlipTimeline } from '../../engine/flip';
import { FlipMedia } from '../../engine/flipMedia';
import { flipFrame } from '../../engine/flipRenderer';
import type { Lut } from '../../engine/luts';
import type { MediaAsset } from '../../engine/reel';
import type { DrawableImage } from '../../engine/renderer';
import type { Ratio } from '../../engine/types';
import { Player, type PlayerController, type PlayerSegment } from '../Player';

interface Props {
  project: FlipProject;
  timeline: FlipTimeline;
  footage: [MediaAsset | null, MediaAsset | null];
  /** Cleaned-up sound per clip, played instead of the clip's own when set. */
  enhanced: [AudioBuffer | null, AudioBuffer | null];
  getImage: (id: string | null) => DrawableImage | null;
  getLut: (key: string) => Lut | null;
  controllerRef: RefObject<PlayerController | null>;
  onRatioChange: (ratio: Ratio) => void;
  redrawKey: unknown;
  active: boolean;
}

export function FlipPreview(props: Props) {
  const { project, timeline, controllerRef } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<FlipMedia | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const media = new FlipMedia(hostRef.current ?? document.body);
    media.onFrame = () => controllerRef.current?.invalidate();
    mediaRef.current = media;
    return () => {
      media.dispose();
      mediaRef.current = null;
      compositorRef.current?.dispose();
    };
  }, [controllerRef]);

  const [footageNew, footageOriginal] = props.footage;
  useEffect(() => {
    mediaRef.current?.setAssets([footageNew, footageOriginal]);
    controllerRef.current?.resync();
  }, [footageNew, footageOriginal, controllerRef]);

  const [enhancedNew, enhancedOriginal] = props.enhanced;
  useEffect(() => {
    mediaRef.current?.setAudio(0, enhancedNew);
    mediaRef.current?.setAudio(1, enhancedOriginal);
    controllerRef.current?.resync();
  }, [enhancedNew, enhancedOriginal, controllerRef]);

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
      flipFrame({ project, timeline, t, footage: (part) => media?.frame(part) ?? null, getImage: props.getImage }, props.getLut, safeZones),
    );
  };

  const segments = useMemo<PlayerSegment[]>(() => {
    const list: PlayerSegment[] = timeline.order.map((part) => ({
      key: `part-${part}`,
      label: stripMarkup(project.parts[part].tag) || (part === NEW ? 'New' : 'Original'),
      start: timeline.parts[part].start,
      end: timeline.parts[part].end,
    }));
    if (timeline.outroStart < timeline.total) {
      list.push({ key: 'outro', label: 'End', start: timeline.outroStart, end: timeline.total, accent: true });
    }
    return list;
  }, [project.parts, timeline]);

  return (
    <Player
      ratio={project.ratio}
      duration={timeline.total}
      segments={segments}
      controllerRef={controllerRef}
      onRatioChange={props.onRatioChange}
      render={render}
      sync={sync}
      ariaLabel="Sample Flip preview"
      redrawKey={[project, timeline, props.redrawKey]}
      active={props.active}
    >
      <div ref={hostRef} className="offscreen-media" aria-hidden />
    </Player>
  );
}
