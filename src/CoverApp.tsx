import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Preview, type PreviewController } from './components/Preview';
import { TopBar, useExportRunner, useNotice, useUnsavedWarning, type ModeProps } from './components/shell';
import { CoversStep } from './components/steps/CoversStep';
import { ExportStep } from './components/steps/ExportStep';
import { FiltersStep } from './components/steps/FiltersStep';
import { FontsStep } from './components/steps/FontsStep';
import { TextStep } from './components/steps/TextStep';
import { VideoStep } from './components/steps/VideoStep';
import { defaultProject, newSlide, OUTPUT_SIZES } from './engine/defaults';
import { ensureFontsLoaded, fontStack, loadUserFont, unloadUserFont, userFontKey, type UserFontFace } from './engine/fonts';
import { clearPlaceholderCache } from './engine/placeholder';
import type { DrawableImage } from './engine/renderer';
import { morphSection, PLACEHOLDER_CREDITS } from './engine/sections';
import { clearLayoutCache } from './engine/textLayout';
import { buildTimeline } from './engine/timeline';
import type { ImageAsset, Placement, Project, VideoAsset } from './engine/types';
import { loadImageFile, loadVideoFile } from './lib/media';

/** The original mode: album covers + credits over the user's clip. */
export function CoverApp({ active, mode, onModeChange, luts }: ModeProps) {
  const [project, setProject] = useState<Project>(defaultProject);
  const [images, setImages] = useState<Map<string, ImageAsset>>(() => new Map());
  const [video, setVideo] = useState<VideoAsset | null>(null);
  const [fonts, setFonts] = useState<UserFontFace[]>([]);
  const [fontEpoch, setFontEpoch] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);
  const previewRef = useRef<PreviewController | null>(null);
  const { flash, toast } = useNotice();
  const exporter = useExportRunner(flash);

  const update = useCallback((fn: (p: Project) => Project) => setProject(fn), []);
  const timeline = useMemo(() => buildTimeline(project), [project]);

  const getImage = useCallback(
    (id: string | null): DrawableImage | null => {
      if (!id) return null;
      const asset = images.get(id);
      return asset ? { source: asset.image, width: asset.width, height: asset.height } : null;
    },
    [images],
  );

  const getLut = luts.get;

  // Re-measure text whenever a font finishes loading.
  useEffect(() => {
    const onFontsLoaded = () => {
      clearLayoutCache();
      clearPlaceholderCache();
      setFontEpoch((e) => e + 1);
    };
    document.fonts.addEventListener('loadingdone', onFontsLoaded);
    void ensureFontsLoaded([fontStack('inter')], [300, 400, 700, 800]).then(onFontsLoaded);
    return () => document.fonts.removeEventListener('loadingdone', onFontsLoaded);
  }, []);

  useUnsavedWarning(!!video || images.size > 0 || fonts.length > 0);

  /* ---------------- Uploads ---------------- */

  const onVideoFile = async (file: File) => {
    try {
      const asset = await loadVideoFile(file);
      setVideo((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return asset;
      });
      update((p) => ({ ...p, video: { ...p.video, start: 0 } }));
      flash('info', `Loaded “${file.name}”.`);
    } catch (err) {
      flash('error', err instanceof Error ? err.message : String(err));
    }
  };

  const addImages = async (files: File[]): Promise<ImageAsset[]> => {
    const loaded: ImageAsset[] = [];
    for (const file of files) {
      try {
        loaded.push(await loadImageFile(file));
      } catch (err) {
        flash('error', err instanceof Error ? err.message : String(err));
      }
    }
    if (loaded.length) {
      setImages((old) => {
        const next = new Map(old);
        for (const a of loaded) next.set(a.id, a);
        return next;
      });
    }
    return loaded;
  };

  const onAddCovers = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name));
    const loaded = await addImages(imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
    if (!loaded.length) return;
    update((p) => {
      const slides = [...p.slides];
      const queue = [...loaded];
      // Fill slides that still show a placeholder first, then append new slides.
      for (let i = 0; i < slides.length && queue.length; i++) {
        if (!slides[i].coverId) slides[i] = { ...slides[i], coverId: queue.shift()!.id };
      }
      const main = morphSection(p.sections);
      for (const asset of queue) {
        slides.push(newSlide({ coverId: asset.id, texts: main ? { [main.id]: PLACEHOLDER_CREDITS } : {} }));
      }
      return { ...p, slides };
    });
    flash('info', `Added ${loaded.length} cover${loaded.length > 1 ? 's' : ''}.`);
  };

  const onReplaceCover = async (index: number, file: File) => {
    const [asset] = await addImages([file]);
    if (asset) update((p) => ({ ...p, slides: p.slides.map((s, k) => (k === index ? { ...s, coverId: asset.id } : s)) }));
  };

  const onLogoFile = async (file: File) => {
    const [asset] = await addImages([file]);
    if (asset) update((p) => ({ ...p, endCard: { ...p.endCard, logoId: asset.id, enabled: true } }));
  };

  const onFontFiles = async (files: File[]) => {
    const loaded: UserFontFace[] = [];
    for (const file of files) {
      try {
        loaded.push(await loadUserFont(file));
      } catch {
        flash('error', `Couldn't read “${file.name}” as a font.`);
      }
    }
    if (!loaded.length) return;
    setFonts((old) => [...old, ...loaded]);
    const family = loaded[0].family;
    // Switch to the new font straight away — that's almost always what people want.
    update((p) => ({ ...p, text: { ...p.text, family: userFontKey(family), headlineFamily: userFontKey(family) } }));
    clearLayoutCache();
    setFontEpoch((e) => e + 1);
    flash('info', `Loaded ${loaded.length} font file${loaded.length > 1 ? 's' : ''} · using “${family}”.`);
  };

  const onRemoveFamily = (family: string) => {
    fonts.filter((f) => f.family === family).forEach(unloadUserFont);
    setFonts((old) => old.filter((f) => f.family !== family));
    const key = userFontKey(family);
    update((p) => ({
      ...p,
      text: {
        ...p.text,
        family: p.text.family === key ? 'inter' : p.text.family,
        headlineFamily: p.text.headlineFamily === key ? 'inter' : p.text.headlineFamily,
      },
    }));
    clearLayoutCache();
    setFontEpoch((e) => e + 1);
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

  /* ---------------- Navigation ---------------- */

  const selectSlide = (i: number) => {
    setActiveSlide(i);
    const seg = timeline.segments[i];
    if (!seg) return;
    const slide = project.slides[i];
    const m = project.motion;
    const hasMorph = !!morphSection(project.sections) && !!slide.morphFrom.trim();
    const morph = hasMorph ? m.morphDuration + (i === 0 ? m.introDelay : 0.35) : 0;
    const settle = i === 0 ? Math.max(morph, m.fanOut ? m.introDelay + 1.1 : 0) : m.transition * 1.6 + morph;
    previewRef.current?.seek(seg.start + Math.min(settle + 0.05, seg.end - seg.start - 0.05));
  };

  /* ---------------- Export ---------------- */

  const onExport = () => {
    previewRef.current?.pause();
    const [width, height] = OUTPUT_SIZES[project.ratio][project.export.resolution];
    void exporter.run({
      filePrefix: 'covervinyl',
      ratio: project.ratio,
      firstLabel: 'Loading fonts…',
      prepare: async () => {
        const t = project.text;
        await ensureFontsLoaded([fontStack(t.family), fontStack(t.headlineFamily)], Object.values(t.weights));
        clearLayoutCache();
      },
      job: async (signal, onProgress) => {
        // The encoder (Mediabunny + AAC WASM) is large, so it's only loaded when exporting.
        const { exportVideo } = await import('./export');
        return exportVideo(
          { project, timeline, width, height, fps: project.export.fps, video, getImage, getLut, signal, onProgress },
          project.export.method,
        );
      },
    });
  };

  const onPlacementChange = useCallback(
    (placement: Placement) => update((p) => ({ ...p, placement: { ...p.placement, [p.ratio]: placement } })),
    [update],
  );
  const onRatioChange = useCallback((ratio: Project['ratio']) => update((p) => ({ ...p, ratio })), [update]);

  return (
    <div className="app" hidden={!active}>
      <TopBar mode={mode} onModeChange={onModeChange} onExport={onExport} exporting={exporter.exporting} />

      <main className="workspace">
        <div className="panels">
          <VideoStep
            project={project}
            update={update}
            video={video}
            editLength={timeline.total}
            onVideoFile={onVideoFile}
            onRemoveVideo={() => {
              if (video) URL.revokeObjectURL(video.url);
              setVideo(null);
            }}
          />
          <CoversStep
            project={project}
            update={update}
            images={images}
            activeSlide={activeSlide}
            onAddCovers={onAddCovers}
            onReplaceCover={onReplaceCover}
            onSelectSlide={selectSlide}
          />
          <TextStep project={project} update={update} images={images} activeSlide={activeSlide} onSelectSlide={selectSlide} />
          <FontsStep project={project} update={update} fonts={fonts} onFontFiles={onFontFiles} onRemoveFamily={onRemoveFamily} />
          <FiltersStep
            step={5}
            post={project.post}
            setPost={(patch) => update((p) => ({ ...p, post: { ...p.post, ...patch } }))}
            customLuts={luts.custom}
            onLutFile={onLutFile}
            onRemoveLut={onRemoveLut}
          />
          <ExportStep
            project={project}
            update={update}
            images={images}
            video={video}
            timeline={timeline}
            onLogoFile={onLogoFile}
            onExport={onExport}
            exporting={exporter.exporting}
          />
          <footer className="credits">Everything runs in your browser — your files never leave your device.</footer>
        </div>

        <div className="stage">
          <Preview
            project={project}
            timeline={timeline}
            video={video}
            getImage={getImage}
            getLut={getLut}
            redrawKey={`${images.size}:${fontEpoch}:${luts.custom.length}`}
            controllerRef={previewRef}
            onPlacementChange={onPlacementChange}
            onRatioChange={onRatioChange}
            active={active}
          />
        </div>
      </main>

      {toast}
      {exporter.dialog}
    </div>
  );
}
