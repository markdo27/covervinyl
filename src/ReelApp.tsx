import { useCallback, useMemo, useRef, useState } from 'react';
import type { PlayerController } from './components/Player';
import { MediaStep } from './components/reel/MediaStep';
import { MusicStep } from './components/reel/MusicStep';
import { OverlayStep } from './components/reel/OverlayStep';
import { ReelExportStep } from './components/reel/ReelExportStep';
import { ReelPreview } from './components/reel/ReelPreview';
import { usePresetDialogs, type Attachment } from './components/PresetDialogs';
import { TopBar, useExportRunner, useNotice, useUnsavedWarning, type ModeProps } from './components/shell';
import { useLooks } from './components/useLooks';
import { FiltersStep } from './components/steps/FiltersStep';
import { OUTPUT_SIZES } from './engine/defaults';
import { loadOverlayFiles, overlayFiles, releaseOverlay, type OverlayAsset } from './engine/overlay';
import { applyReelPreset, embedLut, makePreset, reelPresetSettings, type PresetFiles } from './engine/presets';
import { buildReelTimeline, defaultReel, newReelItem, type MediaAsset, type ReelProject } from './engine/reel';
import type { MusicAsset } from './engine/reelMedia';
import type { PostSettings } from './engine/types';
import { isVideoFile, loadMusicFile, loadReelMedia } from './lib/media';
import { embedFile, unembedFile } from './lib/presetFiles';

/**
 * Photo Reel mode: the user's photos and clips cut on the beat, an
 * animation with transparency looping on top, graded with the same looks.
 */
export function ReelApp({ active, mode, onModeChange, luts, pendingPreset, onPreset }: ModeProps) {
  const [project, setProject] = useState<ReelProject>(defaultReel);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [overlay, setOverlay] = useState<OverlayAsset | null>(null);
  const [music, setMusic] = useState<MusicAsset | null>(null);
  const [activeShot, setActiveShot] = useState(0);
  const previewRef = useRef<PlayerController | null>(null);
  const { flash, toast } = useNotice();
  const exporter = useExportRunner(flash);

  const update = useCallback((fn: (p: ReelProject) => ReelProject) => setProject(fn), []);
  const setPost = useCallback((patch: Partial<PostSettings>) => update((p) => ({ ...p, post: { ...p.post, ...patch } })), [update]);
  const looks = useLooks(luts, project.post, setPost, flash);
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

  /* ---------------- Presets ---------------- */

  const presets = usePresetDialogs({
    mode: 'reel',
    active,
    pending: pendingPreset,
    onPreset,
    flash,
    getAttachments: () => {
      const list: Attachment[] = [];
      if (overlay) {
        const files = overlayFiles(overlay);
        list.push({
          key: 'overlay',
          label: `Animation: ${overlay.name}`,
          detail: files.length > 1 ? `${files.length} frames` : 'Your animation on top',
          bytes: files.reduce((sum, f) => sum + f.size, 0),
        });
      }
      const lut = looks.lutAttachment();
      if (lut) list.push(lut);
      return list;
    },
    build: async (name, include) => {
      const files: PresetFiles = {};
      if (include.has('overlay') && overlay) files.overlay = await Promise.all(overlayFiles(overlay).map(embedFile));
      const lut = looks.customLut();
      if (include.has('lut') && lut) files.lut = embedLut(lut);
      return makePreset(name, { mode: 'reel', settings: reelPresetSettings(project) }, files);
    },
    apply: async (preset, groups) => {
      if (preset.mode !== 'reel') return [];
      const s = preset.settings;
      const warnings: string[] = [];

      if (groups.has('overlay') && preset.files.overlay) {
        try {
          const asset = await loadOverlayFiles(await Promise.all(preset.files.overlay.map(unembedFile)));
          setOverlay((old) => {
            if (old) releaseOverlay(old);
            return asset;
          });
        } catch (err) {
          warnings.push(err instanceof Error ? err.message : String(err));
        }
      }

      let lutKey: string | null = null;
      if (groups.has('look')) {
        const look = looks.adoptPresetLut(preset.files.lut, s.post.lut);
        lutKey = look.lutKey;
        if (look.warning) warnings.push(look.warning);
      }

      update((p) => applyReelPreset(p, s, groups, { lutKey }));
      return warnings;
    },
  });

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
      <TopBar
        mode={mode}
        onModeChange={onModeChange}
        onExport={onExport}
        exporting={exporter.exporting}
        onSavePreset={presets.openSave}
        onPreset={onPreset}
        flash={flash}
      />

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
            setPost={setPost}
            customLuts={luts.custom}
            onLutFile={looks.onLutFile}
            onRemoveLut={looks.onRemoveLut}
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
      {presets.dialogs}
    </div>
  );
}
