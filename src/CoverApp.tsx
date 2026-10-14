import { useCallback, useMemo, useRef, useState } from 'react';
import { usePresetDialogs, type Attachment } from './components/PresetDialogs';
import { Preview, type PreviewController } from './components/Preview';
import { TopBar, useExportRunner, useNotice, useUnsavedWarning, type ModeProps } from './components/shell';
import { useLooks } from './components/useLooks';
import { useUserFonts } from './components/useUserFonts';
import { CoversStep } from './components/steps/CoversStep';
import { ExportStep } from './components/steps/ExportStep';
import { FiltersStep } from './components/steps/FiltersStep';
import { FontsStep } from './components/steps/FontsStep';
import { TextStep } from './components/steps/TextStep';
import { VideoStep } from './components/steps/VideoStep';
import { defaultProject, newSlide, OUTPUT_SIZES } from './engine/defaults';
import { ensureFontsLoaded, fontStack, userFontKey } from './engine/fonts';
import { applyCoverPreset, coverPresetSettings, embedLut, makePreset, type PresetFiles } from './engine/presets';
import type { DrawableImage } from './engine/renderer';
import { morphSection, PLACEHOLDER_CREDITS } from './engine/sections';
import { clearLayoutCache } from './engine/textLayout';
import { buildTimeline } from './engine/timeline';
import type { ImageAsset, Placement, PostSettings, Project, VideoAsset } from './engine/types';
import { enhanceClipAudio, useEnhancedAudio } from './lib/audioEnhance';
import { loadImageFile, loadVideoFile } from './lib/media';
import { embedFile, unembedFile } from './lib/presetFiles';

/** The original mode: album covers + credits over the user's clip. */
export function CoverApp({ active, mode, onModeChange, luts, pendingPreset, onPreset }: ModeProps) {
  const [project, setProject] = useState<Project>(defaultProject);
  const [images, setImages] = useState<Map<string, ImageAsset>>(() => new Map());
  const [video, setVideo] = useState<VideoAsset | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const previewRef = useRef<PreviewController | null>(null);
  const { flash, toast } = useNotice();
  const exporter = useExportRunner(flash);
  const userFonts = useUserFonts(flash);
  const { fonts, fontEpoch } = userFonts;

  const update = useCallback((fn: (p: Project) => Project) => setProject(fn), []);
  const setPost = useCallback((patch: Partial<PostSettings>) => update((p) => ({ ...p, post: { ...p.post, ...patch } })), [update]);
  const looks = useLooks(luts, project.post, setPost, flash);
  const enhanced = useEnhancedAudio(video && project.video.audio ? video.file : null, project.video.enhance);
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
    const loaded = await userFonts.addFiles(files);
    if (!loaded.length) return;
    const family = loaded[0].family;
    // Switch to the new font straight away — that's almost always what people want.
    update((p) => ({ ...p, text: { ...p.text, family: userFontKey(family), headlineFamily: userFontKey(family) } }));
    flash('info', `Loaded ${loaded.length} font file${loaded.length > 1 ? 's' : ''} · using “${family}”.`);
  };

  const onRemoveFamily = (family: string) => {
    userFonts.removeFamily(family);
    const key = userFontKey(family);
    update((p) => ({
      ...p,
      text: {
        ...p.text,
        family: p.text.family === key ? 'inter' : p.text.family,
        headlineFamily: p.text.headlineFamily === key ? 'inter' : p.text.headlineFamily,
      },
    }));
  };

  /* ---------------- Presets ---------------- */

  const usedFontFiles = () => userFonts.filesFor(project.text);
  const logoAsset = () => (project.endCard.logoId ? images.get(project.endCard.logoId) : undefined);

  const presets = usePresetDialogs({
    mode: 'cover',
    active,
    pending: pendingPreset,
    onPreset,
    flash,
    getAttachments: () => {
      const list: Attachment[] = [];
      const fontFiles = usedFontFiles();
      if (fontFiles.length) {
        const families = [...new Set(fontFiles.map((f) => f.family))];
        list.push({
          key: 'fonts',
          label: `Font${families.length > 1 ? 's' : ''}: ${families.join(', ')}`,
          detail: `${fontFiles.length} font file${fontFiles.length > 1 ? 's' : ''}`,
          bytes: fontFiles.reduce((sum, f) => sum + f.file.size, 0),
        });
      }
      const lut = looks.lutAttachment();
      if (lut) list.push(lut);
      const logo = logoAsset();
      if (logo) list.push({ key: 'logo', label: `Logo: ${logo.name}`, detail: 'End-card logo', bytes: logo.file.size });
      return list;
    },
    build: async (name, include) => {
      const files: PresetFiles = {};
      const fontFiles = usedFontFiles();
      if (include.has('fonts') && fontFiles.length) files.fonts = await Promise.all(fontFiles.map((f) => embedFile(f.file)));
      const lut = looks.customLut();
      if (include.has('lut') && lut) files.lut = embedLut(lut);
      const logo = logoAsset();
      if (include.has('logo') && logo) files.logo = await embedFile(logo.file);
      return makePreset(name, { mode: 'cover', settings: coverPresetSettings(project) }, files);
    },
    apply: async (preset, groups) => {
      if (preset.mode !== 'cover') return [];
      const s = preset.settings;
      const warnings: string[] = [];

      // Fonts the preset carries, skipping files that are already loaded.
      const fontsLoaded = await userFonts.loadEmbedded(groups.has('style') ? preset.files.fonts : undefined);
      const { hasFont } = fontsLoaded;
      warnings.push(...fontsLoaded.warnings);
      const fontWarning = groups.has('style') ? userFonts.missingFontWarning(s.text, hasFont) : null;
      if (fontWarning) warnings.push(fontWarning);

      let logoId: string | null = null;
      if (groups.has('endCard') && preset.files.logo) {
        const [asset] = await addImages([await unembedFile(preset.files.logo)]);
        logoId = asset?.id ?? null;
      }

      let lutKey: string | null = null;
      if (groups.has('look')) {
        const look = looks.adoptPresetLut(preset.files.lut, s.post.lut);
        lutKey = look.lutKey;
        if (look.warning) warnings.push(look.warning);
      }

      update((p) => applyCoverPreset(p, s, groups, { lutKey, logoId, hasFont }));
      if (groups.has('slides')) setActiveSlide(0);
      return warnings;
    },
  });

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
        let enhancedAudio: AudioBuffer | null = null;
        if (video && project.video.audio && project.video.enhance.enabled) {
          onProgress(0, 'Cleaning up the sound…');
          enhancedAudio = (await enhanceClipAudio(video.file, project.video.enhance))?.buffer ?? null;
        }
        // The encoder (Mediabunny + AAC WASM) is large, so it's only loaded when exporting.
        const { exportVideo } = await import('./export');
        return exportVideo(
          { project, timeline, width, height, fps: project.export.fps, video, enhancedAudio, getImage, getLut, signal, onProgress },
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
            enhanceStatus={enhanced.status}
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
          <FontsStep
            step={4}
            text={project.text}
            setText={(patch) => update((p) => ({ ...p, text: { ...p.text, ...patch } }))}
            fonts={fonts}
            onFontFiles={onFontFiles}
            onRemoveFamily={onRemoveFamily}
          />
          <FiltersStep
            step={5}
            post={project.post}
            setPost={setPost}
            customLuts={luts.custom}
            onLutFile={looks.onLutFile}
            onRemoveLut={looks.onRemoveLut}
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
            enhancedAudio={enhanced.buffer}
          />
        </div>
      </main>

      {toast}
      {exporter.dialog}
      {presets.dialogs}
    </div>
  );
}
