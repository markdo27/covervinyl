import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportDialog, type ExportStatus } from './components/ExportDialog';
import { Preview, type PreviewController } from './components/Preview';
import { CoversStep } from './components/steps/CoversStep';
import { ExportStep } from './components/steps/ExportStep';
import { FontsStep } from './components/steps/FontsStep';
import { TextStep } from './components/steps/TextStep';
import { VideoStep } from './components/steps/VideoStep';
import { defaultProject, newSlide, OUTPUT_SIZES } from './engine/defaults';
import { ensureFontsLoaded, fontStack, loadUserFont, unloadUserFont, userFontKey, type UserFontFace } from './engine/fonts';
import { clearPlaceholderCache } from './engine/placeholder';
import type { DrawableImage } from './engine/renderer';
import { clearLayoutCache } from './engine/textLayout';
import { buildTimeline } from './engine/timeline';
import type { ImageAsset, Placement, Project, VideoAsset } from './engine/types';
import { loadImageFile, loadVideoFile } from './lib/media';

export default function App() {
  const [project, setProject] = useState<Project>(defaultProject);
  const [images, setImages] = useState<Map<string, ImageAsset>>(() => new Map());
  const [video, setVideo] = useState<VideoAsset | null>(null);
  const [fonts, setFonts] = useState<UserFontFace[]>([]);
  const [fontEpoch, setFontEpoch] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const previewRef = useRef<PreviewController | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const flash = useCallback((kind: 'error' | 'info', text: string) => setNotice({ kind, text }), []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), notice.kind === 'error' ? 8000 : 3500);
    return () => clearTimeout(id);
  }, [notice]);

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

  // Warn before losing uploads.
  useEffect(() => {
    const hasWork = !!video || images.size > 0 || fonts.length > 0;
    if (!hasWork) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [video, images.size, fonts.length]);

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
      for (const asset of queue) slides.push(newSlide({ coverId: asset.id }));
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

  /* ---------------- Navigation ---------------- */

  const selectSlide = (i: number) => {
    setActiveSlide(i);
    const seg = timeline.segments[i];
    if (!seg) return;
    const slide = project.slides[i];
    const m = project.motion;
    const morph = slide.morphFrom.trim() ? m.morphDuration + (i === 0 ? m.introDelay : 0.35) : 0;
    const settle = i === 0 ? Math.max(morph, m.fanOut ? m.introDelay + 1.1 : 0) : m.transition * 1.6 + morph;
    previewRef.current?.seek(seg.start + Math.min(settle + 0.05, seg.end - seg.start - 0.05));
  };

  /* ---------------- Export ---------------- */

  const onExport = async () => {
    previewRef.current?.pause();
    const [width, height] = OUTPUT_SIZES[project.ratio][project.export.resolution];
    const controller = new AbortController();
    abortRef.current = controller;
    setExportStatus({ phase: 'running', progress: 0, label: 'Loading fonts…' });
    const t = project.text;
    await ensureFontsLoaded([fontStack(t.family), fontStack(t.headlineFamily)], Object.values(t.weights));
    clearLayoutCache();
    const started = performance.now();
    try {
      // The encoder (Mediabunny + AAC WASM) is large, so it's only loaded when exporting.
      const { exportVideo } = await import('./export');
      const result = await exportVideo(
        {
          project,
          timeline,
          width,
          height,
          fps: project.export.fps,
          video,
          getImage,
          signal: controller.signal,
          onProgress: (progress, label) => {
            if (!controller.signal.aborted) setExportStatus({ phase: 'running', progress, label });
          },
        },
        project.export.method,
      );
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      setExportStatus({
        phase: 'done',
        result,
        fileName: `covervinyl-${project.ratio.replace(':', 'x')}-${stamp}.${result.extension}`,
        seconds: (performance.now() - started) / 1000,
      });
    } catch (err) {
      if ((err instanceof Error && err.name === 'ExportAbortedError') || controller.signal.aborted) {
        setExportStatus(null);
        flash('info', 'Export cancelled.');
      } else {
        console.error(err);
        setExportStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      abortRef.current = null;
    }
  };

  const onPlacementChange = useCallback(
    (placement: Placement) => update((p) => ({ ...p, placement: { ...p.placement, [p.ratio]: placement } })),
    [update],
  );
  const onRatioChange = useCallback((ratio: Project['ratio']) => update((p) => ({ ...p, ratio })), [update]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <span />
          </span>
          <span>
            <strong>CoverVinyl</strong>
            <small>Album-cover reels from your own footage</small>
          </span>
        </div>
        <button type="button" className="btn-primary" onClick={onExport} disabled={exportStatus?.phase === 'running'}>
          Export
        </button>
      </header>

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
          <ExportStep
            project={project}
            update={update}
            images={images}
            video={video}
            timeline={timeline}
            onLogoFile={onLogoFile}
            onExport={onExport}
            exporting={exportStatus?.phase === 'running'}
          />
          <footer className="credits">Everything runs in your browser — your files never leave your device.</footer>
        </div>

        <div className="stage">
          <Preview
            project={project}
            timeline={timeline}
            video={video}
            getImage={getImage}
            redrawKey={`${images.size}:${fontEpoch}`}
            controllerRef={previewRef}
            onPlacementChange={onPlacementChange}
            onRatioChange={onRatioChange}
          />
        </div>
      </main>

      {notice && (
        <div className={`toast ${notice.kind === 'error' ? 'is-error' : ''}`} role="status" onClick={() => setNotice(null)}>
          {notice.text}
        </div>
      )}

      {exportStatus && (
        <ExportDialog status={exportStatus} onCancel={() => abortRef.current?.abort()} onClose={() => setExportStatus(null)} />
      )}
    </div>
  );
}
