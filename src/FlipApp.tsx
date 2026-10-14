import { useCallback, useMemo, useRef, useState } from 'react';
import { FlipClipsStep } from './components/flip/FlipClipsStep';
import { FlipCreditsStep } from './components/flip/FlipCreditsStep';
import { FlipExportStep } from './components/flip/FlipExportStep';
import { FlipPreview } from './components/flip/FlipPreview';
import { FlipStyleStep } from './components/flip/FlipStyleStep';
import type { PlayerController } from './components/Player';
import { usePresetDialogs, type Attachment } from './components/PresetDialogs';
import { TopBar, useExportRunner, useNotice, useUnsavedWarning, type ModeProps } from './components/shell';
import { FiltersStep } from './components/steps/FiltersStep';
import { FontsStep } from './components/steps/FontsStep';
import { useLooks } from './components/useLooks';
import { useUserFonts } from './components/useUserFonts';
import { OUTPUT_SIZES } from './engine/defaults';
import { buildFlipTimeline, defaultFlip, type FlipPart, type FlipProject } from './engine/flip';
import { partTextWindow } from './engine/flipRenderer';
import { ensureFontsLoaded, fontStack, userFontKey } from './engine/fonts';
import { applyFlipPreset, embedLut, flipPresetSettings, makePreset, type PresetFiles } from './engine/presets';
import type { MediaAsset } from './engine/reel';
import type { DrawableImage } from './engine/renderer';
import { clearLayoutCache } from './engine/textLayout';
import type { ImageAsset, PostSettings, TextStyle } from './engine/types';
import { loadImageFile, loadReelMedia } from './lib/media';
import { embedFile, unembedFile } from './lib/presetFiles';

/**
 * Sample Flip mode: the new track's clip and the original it samples, back
 * to back, each with its own cover and credits, then an end card with your logo.
 */
export function FlipApp({ active, mode, onModeChange, luts, pendingPreset, onPreset }: ModeProps) {
  const [project, setProject] = useState<FlipProject>(defaultFlip);
  const [media, setMedia] = useState<Map<string, MediaAsset>>(() => new Map());
  const [covers, setCovers] = useState<Map<string, ImageAsset>>(() => new Map());
  const [activePart, setActivePart] = useState(0);
  const previewRef = useRef<PlayerController | null>(null);
  const { flash, toast } = useNotice();
  const exporter = useExportRunner(flash);
  const userFonts = useUserFonts(flash);

  const update = useCallback((fn: (p: FlipProject) => FlipProject) => setProject(fn), []);
  const setPost = useCallback((patch: Partial<PostSettings>) => update((p) => ({ ...p, post: { ...p.post, ...patch } })), [update]);
  const setText = useCallback((patch: Partial<TextStyle>) => update((p) => ({ ...p, text: { ...p.text, ...patch } })), [update]);
  const setPart = useCallback(
    (part: number, patch: Partial<FlipPart>) =>
      update((p) => {
        const parts = [...p.parts] as FlipProject['parts'];
        parts[part] = { ...parts[part], ...patch };
        return { ...p, parts };
      }),
    [update],
  );
  const looks = useLooks(luts, project.post, setPost, flash);

  const timeline = useMemo(() => buildFlipTimeline(project), [project]);
  const [newId, originalId] = [project.parts[0].assetId, project.parts[1].assetId];
  const footage = useMemo<[MediaAsset | null, MediaAsset | null]>(
    () => [(newId && media.get(newId)) || null, (originalId && media.get(originalId)) || null],
    [media, newId, originalId],
  );
  const getImage = useCallback(
    (id: string | null): DrawableImage | null => {
      const asset = id ? covers.get(id) : undefined;
      return asset ? { source: asset.image, width: asset.width, height: asset.height } : null;
    },
    [covers],
  );

  useUnsavedWarning(media.size > 0 || covers.size > 0 || userFonts.fonts.length > 0);

  /* ---------------- Uploads ---------------- */

  /** Frees a part's current footage once nothing else uses it. */
  const releaseFootage = (part: number) => {
    const id = project.parts[part].assetId;
    const asset = id ? media.get(id) : undefined;
    if (!asset || project.parts[1 - part].assetId === id) return;
    URL.revokeObjectURL(asset.url);
    setMedia((old) => {
      const next = new Map(old);
      next.delete(asset.id);
      return next;
    });
  };

  const onFootageFile = async (part: number, file: File) => {
    try {
      const asset = await loadReelMedia(file);
      releaseFootage(part);
      setMedia((old) => new Map(old).set(asset.id, asset));
      update((p) => {
        const parts = [...p.parts] as FlipProject['parts'];
        const current = parts[part];
        // A clip shorter than the part plays once instead of looping.
        const fits = asset.kind === 'video' && asset.duration >= 1 ? Math.min(current.duration, Math.floor(asset.duration * 10) / 10) : current.duration;
        parts[part] = { ...current, assetId: asset.id, start: 0, duration: fits };
        return { ...p, parts };
      });
      flash('info', `Loaded “${file.name}”.`);
    } catch (err) {
      flash('error', err instanceof Error ? err.message : String(err));
    }
  };

  const onRemoveFootage = (part: number) => {
    releaseFootage(part);
    setPart(part, { assetId: null, start: 0 });
  };

  const addCover = async (file: File): Promise<ImageAsset | null> => {
    try {
      const asset = await loadImageFile(file);
      setCovers((old) => new Map(old).set(asset.id, asset));
      return asset;
    } catch (err) {
      flash('error', err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const onCoverFile = async (part: number, file: File) => {
    const asset = await addCover(file);
    if (asset) setPart(part, { coverId: asset.id });
  };

  const onLogoFile = async (file: File) => {
    const asset = await addCover(file);
    if (asset) update((p) => ({ ...p, outro: { ...p.outro, logoId: asset.id, enabled: true } }));
  };
  const logoAsset = () => (project.outro.logoId ? covers.get(project.outro.logoId) : undefined);

  const onFontFiles = async (files: File[]) => {
    const loaded = await userFonts.addFiles(files);
    if (!loaded.length) return;
    const family = loaded[0].family;
    setText({ family: userFontKey(family), headlineFamily: userFontKey(family) });
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

  const presets = usePresetDialogs({
    mode: 'flip',
    active,
    pending: pendingPreset,
    onPreset,
    flash,
    getAttachments: () => {
      const list: Attachment[] = [];
      const fontFiles = userFonts.filesFor(project.text);
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
      const fontFiles = userFonts.filesFor(project.text);
      if (include.has('fonts') && fontFiles.length) files.fonts = await Promise.all(fontFiles.map((f) => embedFile(f.file)));
      const lut = looks.customLut();
      if (include.has('lut') && lut) files.lut = embedLut(lut);
      const logo = logoAsset();
      if (include.has('logo') && logo) files.logo = await embedFile(logo.file);
      return makePreset(name, { mode: 'flip', settings: flipPresetSettings(project) }, files);
    },
    apply: async (preset, groups) => {
      if (preset.mode !== 'flip') return [];
      const s = preset.settings;
      const warnings: string[] = [];
      const fontsLoaded = await userFonts.loadEmbedded(groups.has('style') ? preset.files.fonts : undefined);
      warnings.push(...fontsLoaded.warnings);
      const fontWarning = groups.has('style') ? userFonts.missingFontWarning(s.text, fontsLoaded.hasFont) : null;
      if (fontWarning) warnings.push(fontWarning);
      let lutKey: string | null = null;
      if (groups.has('look')) {
        const look = looks.adoptPresetLut(preset.files.lut, s.post.lut);
        lutKey = look.lutKey;
        if (look.warning) warnings.push(look.warning);
      }
      let logoId: string | null = null;
      if (groups.has('endCard') && preset.files.logo) logoId = (await addCover(await unembedFile(preset.files.logo)))?.id ?? null;
      update((p) => applyFlipPreset(p, s, groups, { lutKey, logoId, hasFont: fontsLoaded.hasFont }));
      return warnings;
    },
  });

  /* ---------------- Navigation ---------------- */

  const selectPart = (part: number) => {
    setActivePart(part);
    const win = partTextWindow(project, timeline, part);
    const span = timeline.parts[part];
    previewRef.current?.seek(Math.min(span.end - 0.1, win.start + 1.2));
  };

  /* ---------------- Export ---------------- */

  const onExport = () => {
    previewRef.current?.pause();
    const [width, height] = OUTPUT_SIZES[project.ratio][project.export.resolution];
    void exporter.run({
      filePrefix: 'covervinyl-flip',
      ratio: project.ratio,
      firstLabel: 'Loading fonts…',
      prepare: async () => {
        const t = project.text;
        await ensureFontsLoaded([fontStack(t.family), fontStack(t.headlineFamily)], Object.values(t.weights));
        clearLayoutCache();
      },
      job: async (signal, onProgress) => {
        const { exportFlip } = await import('./export/flip');
        return exportFlip(
          { project, timeline, width, height, fps: project.export.fps, footage, getImage, getLut: luts.get, signal, onProgress },
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
          <FlipClipsStep
            project={project}
            update={update}
            timeline={timeline}
            footage={footage}
            onFootageFile={onFootageFile}
            onRemoveFootage={onRemoveFootage}
            onSelectPart={selectPart}
          />
          <FlipCreditsStep
            project={project}
            update={update}
            covers={covers}
            activePart={activePart}
            onSelectPart={selectPart}
            onCoverFile={onCoverFile}
          />
          <FlipStyleStep project={project} update={update} />
          <FontsStep
            step={4}
            text={project.text}
            setText={setText}
            fonts={userFonts.fonts}
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
          <FlipExportStep
            project={project}
            update={update}
            timeline={timeline}
            images={covers}
            onLogoFile={onLogoFile}
            onExport={onExport}
            exporting={exporter.exporting}
          />
          <footer className="credits">Everything runs in your browser — your files never leave your device.</footer>
        </div>

        <div className="stage">
          <FlipPreview
            project={project}
            timeline={timeline}
            footage={footage}
            getImage={getImage}
            getLut={luts.get}
            controllerRef={previewRef}
            onRatioChange={(ratio) => update((p) => ({ ...p, ratio }))}
            redrawKey={`${covers.size}:${userFonts.fontEpoch}:${luts.custom.length}`}
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
