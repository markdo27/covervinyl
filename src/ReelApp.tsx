import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerController } from './components/Player';
import { MediaStep } from './components/reel/MediaStep';
import { MusicStep } from './components/reel/MusicStep';
import { OverlayStep } from './components/reel/OverlayStep';
import { ReelExportStep } from './components/reel/ReelExportStep';
import { ReelPreview } from './components/reel/ReelPreview';
import { TopBar, useExportRunner, useNotice, useUnsavedWarning, type ModeProps } from './components/shell';
import { FiltersStep } from './components/steps/FiltersStep';
import { OUTPUT_SIZES } from './engine/defaults';
import { loadOverlayFiles, releaseOverlay, type OverlayAsset } from './engine/overlay';
import { buildReelTimeline, defaultReel, newReelItem, type MediaAsset, type ReelProject } from './engine/reel';
import type { MusicAsset } from './engine/reelMedia';
import { isVideoFile, loadMusicFile, loadReelMedia } from './lib/media';

/**
 * Photo Reel mode: the user's photos and clips cut on the beat, an
 * animation with transparency looping on top, graded with the same looks.
 */
export function ReelApp({ active, mode, onModeChange, luts }: ModeProps) {
  const [project, setProject] = useState<ReelProject>(defaultReel);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [overlay, setOverlay] = useState<OverlayAsset | null>(null);
  const [music, setMusic] = useState<MusicAsset | null>(null);
  const [activeShot, setActiveShot] = useState(0);
  const previewRef = useRef<PlayerController | null>(null);
  const { flash, toast } = useNotice();
  const exporter = useExportRunner(flash);

  const update = useCallback((fn: (p: ReelProject) => ReelProject) => setProject(fn), []);
  const timeline = useMemo(() => buildReelTimeline(project.items), [project.items]);
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const getMedia = useCallback((id: string | null) => (id ? (mediaById.get(id) ?? null) : null), [mediaById]);

  useUnsavedWarning(media.length > 0 || !!overlay || !!music);

  /* ---------------- Uploads ---------------- */

  const loadAll = async (files: File[]): Promise<MediaAsset[]> => {
    const usable = files
      .filter((f) => f.type.startsWith('image/') || isVideoFile(f) || /\.(jpe?g|png|webp|avif|gif)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const loaded: MediaAsset[] = [];
    for (const file of usable) {
      try {
        loaded.push(await loadReelMedia(file));
      } catch (err) {
        flash('error', err instanceof Error ? err.message : String(err));
      }
    }
    if (loaded.length) setMedia((old) => [...old, ...loaded]);
    return loaded;
  };

  const onAddMedia = async (files: File[]) => {
    const loaded = await loadAll(files);
    if (!loaded.length) return;
    update((p) => {
      // The starter placeholders give way to real shots.
      const kept = p.items.filter((it) => it.assetId);
      const duration = p.items[0]?.duration ?? 0.5;
      const added = loaded.map((a) => newReelItem({ assetId: a.id, duration }));
      return { ...p, items: [...kept, ...added] };
    });
    const clips = loaded.filter((m) => m.kind === 'video').length;
    flash('info', `Added ${loaded.length - clips} photo${loaded.length - clips === 1 ? '' : 's'} and ${clips} clip${clips === 1 ? '' : 's'}.`);
  };

  const onReplaceMedia = async (index: number, file: File) => {
    const [asset] = await loadAll([file]);
    if (asset) update((p) => ({ ...p, items: p.items.map((it, k) => (k === index ? { ...it, assetId: asset.id, start: 0 } : it)) }));
  };

  const onOverlayFiles = async (files: File[]) => {
    try {
      const asset = await loadOverlayFiles(files);
      setOverlay((old) => {
        if (old) releaseOverlay(old);
        return asset;
      });
      flash('info', `Loaded animation “${asset.name}”.`);
    } catch (err) {
      flash('error', err instanceof Error ? err.message : String(err));
    }
  };

  const onMusicFile = async (file: File) => {
    try {
      const asset = await loadMusicFile(file);
      setMusic((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return asset;
      });
      update((p) => ({ ...p, music: { ...p.music, start: 0 } }));
      flash('info', `Loaded “${file.name}”.`);
    } catch (err) {
      flash('error', err instanceof Error ? err.message : String(err));
    }
  };

  const onLutFile = async (file: File) => {
    try {
      const lut = await luts.addFile(file);
      update((p) => ({ ...p, post: { ...p.post, lut: lut.key, lutIntensity: 1 } }));
      flash('info', `Loaded LUT “${lut.name}” (${lut.size}³).`);
    } catch (err) {
      flash('error', `Couldn't load “${file.name}”: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onRemoveLut = (key: string) => {
    luts.remove(key);
    update((p) => (p.post.lut === key ? { ...p, post: { ...p.post, lut: 'none' } } : p));
  };

  // A LUT removed in the other mode falls back to no look here too.
  useEffect(() => {
    if (project.post.lut.startsWith('custom:') && !luts.get(project.post.lut)) {
      update((p) => ({ ...p, post: { ...p.post, lut: 'none' } }));
    }
  }, [luts, project.post.lut, update]);

  const selectShot = (i: number) => {
    setActiveShot(i);
    const start = timeline.starts[i];
    if (start !== undefined) previewRef.current?.seek(start + Math.min(0.05, project.items[i].duration / 2));
  };

  /* ---------------- Export ---------------- */

  const onExport = () => {
    previewRef.current?.pause();
    const [width, height] = OUTPUT_SIZES[project.ratio][project.export.resolution];
    void exporter.run({
      filePrefix: 'covervinyl-reel',
      ratio: project.ratio,
      job: async (signal, onProgress) => {
        const { exportReel } = await import('./export/reel');
        return exportReel(
          {
            project,
            timeline,
            width,
            height,
            fps: project.export.fps,
            media,
            getMedia,
            overlay,
            music,
            getLut: luts.get,
            signal,
            onProgress,
          },
          project.export.method,
        );
      },
    });
  };

  return (
    <div className="app" hidden={!active}>
      <TopBar mode={mode} onModeChange={onModeChange} onExport={onExport} exporting={exporter.exporting} />

      <main className="workspace">
        <div className="panels">
          <MediaStep
            project={project}
            update={update}
            timeline={timeline}
            getMedia={getMedia}
            activeShot={activeShot}
            onAddMedia={onAddMedia}
            onReplaceMedia={onReplaceMedia}
            onSelectShot={selectShot}
          />
          <OverlayStep
            project={project}
            update={update}
            overlay={overlay}
            onOverlayFiles={onOverlayFiles}
            onRemoveOverlay={() => {
              setOverlay((old) => {
                if (old) releaseOverlay(old);
                return null;
              });
            }}
          />
          <MusicStep
            project={project}
            update={update}
            music={music}
            onMusicFile={onMusicFile}
            onRemoveMusic={() => {
              setMusic((old) => {
                if (old) URL.revokeObjectURL(old.url);
                return null;
              });
            }}
          />
          <FiltersStep
            step={4}
            post={project.post}
            setPost={(patch) => update((p) => ({ ...p, post: { ...p.post, ...patch } }))}
            customLuts={luts.custom}
            onLutFile={onLutFile}
            onRemoveLut={onRemoveLut}
          />
          <ReelExportStep project={project} update={update} timeline={timeline} onExport={onExport} exporting={exporter.exporting} />
          <footer className="credits">Everything runs in your browser — your files never leave your device.</footer>
        </div>

        <div className="stage">
          <ReelPreview
            project={project}
            timeline={timeline}
            media={media}
            getMedia={getMedia}
            overlay={overlay}
            music={music}
            getLut={luts.get}
            controllerRef={previewRef}
            onOverlayMove={(x, y) => update((p) => ({ ...p, overlay: { ...p.overlay, x, y } }))}
            onRatioChange={(ratio) => update((p) => ({ ...p, ratio }))}
            redrawKey={luts.custom.length}
            active={active}
          />
        </div>
      </main>

      {toast}
      {exporter.dialog}
    </div>
  );
}
