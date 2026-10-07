import { newSlide } from '../../engine/defaults';
import { stripMarkup } from '../../engine/markup';
import type { ImageAsset, Project } from '../../engine/types';
import { FileDrop, PickFile, Section, Slider, Toggle } from '../ui';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  images: Map<string, ImageAsset>;
  activeSlide: number;
  onAddCovers: (files: File[]) => void;
  onReplaceCover: (slideIndex: number, file: File) => void;
  onSelectSlide: (index: number) => void;
}

export function CoversStep({ project, update, images, activeSlide, onAddCovers, onReplaceCover, onSelectSlide }: Props) {
  const c = project.cover;
  const set = (patch: Partial<Project['cover']>) => update((p) => ({ ...p, cover: { ...p.cover, ...patch } }));
  const uploaded = project.slides.filter((s) => s.coverId && images.has(s.coverId)).length;

  const move = (i: number, dir: -1 | 1) =>
    update((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.slides.length) return p;
      const slides = [...p.slides];
      [slides[i], slides[j]] = [slides[j], slides[i]];
      return { ...p, slides };
    });
  const remove = (i: number) =>
    update((p) => (p.slides.length <= 1 ? p : { ...p, slides: p.slides.filter((_, k) => k !== i) }));

  return (
    <Section
      step={2}
      title="Album covers"
      subtitle="One cover per slide — they stack like a record crate"
      done={uploaded > 0}
    >
      <FileDrop
        accept="image/*"
        multiple
        title="Upload album covers"
        hint="Select several at once · JPG, PNG, WebP · square works best"
        icon={<span className="big-icon">💿</span>}
        onFiles={onAddCovers}
      />

      <ol className="cover-grid">
        {project.slides.map((slide, i) => {
          const img = slide.coverId ? images.get(slide.coverId) : undefined;
          return (
            <li key={slide.id} className={`cover-card ${i === activeSlide ? 'is-active' : ''}`}>
              <button
                type="button"
                className="cover-thumb"
                onClick={() => onSelectSlide(i)}
                title={`Jump to slide ${i + 1}`}
                style={img ? { backgroundImage: `url("${img.url}")` } : undefined}
              >
                {!img && <span className="cover-empty">No cover</span>}
                <span className="cover-num">{i + 1}</span>
              </button>
              <span className="cover-caption" title={stripMarkup(slide.text)}>
                {stripMarkup(slide.text) || 'Untitled'}
              </span>
              <div className="cover-actions">
                <PickFile accept="image/*" className="icon-btn" title="Replace cover" onFile={(f) => onReplaceCover(i, f)}>
                  ⤒
                </PickFile>
                <button type="button" className="icon-btn" title="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                  ←
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Move later"
                  disabled={i === project.slides.length - 1}
                  onClick={() => move(i, 1)}
                >
                  →
                </button>
                <button
                  type="button"
                  className="icon-btn is-danger"
                  title="Delete slide"
                  disabled={project.slides.length <= 1}
                  onClick={() => remove(i)}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
        <li className="cover-card is-add">
          <button
            type="button"
            className="cover-thumb add-thumb"
            onClick={() => update((p) => ({ ...p, slides: [...p.slides, newSlide()] }))}
          >
            <span>+</span>
            <small>Add slide</small>
          </button>
        </li>
      </ol>

      <div className="grid-2">
        <Slider label="Cover size" value={c.size} min={0.15} max={0.6} step={0.005} format={(x) => `${Math.round(x * 100)}%`} onChange={(size) => set({ size })} />
        <Slider
          label="Covers behind"
          value={c.stackCount}
          min={0}
          max={8}
          step={1}
          format={(x) => (x === 0 ? 'off' : String(x))}
          onChange={(stackCount) => set({ stackCount })}
        />
        <Slider label="Stack spread" value={c.stackOffset} min={0.04} max={0.4} step={0.005} format={(x) => `${Math.round(x * 100)}%`} onChange={(stackOffset) => set({ stackOffset })} />
        <Slider label="Corner radius" value={c.radius} min={0} max={0.12} step={0.005} format={(x) => `${Math.round(x * 100)}%`} onChange={(radius) => set({ radius })} />
      </div>
      <div className="toggles">
        <Toggle label="Cover shadow" checked={c.shadow} onChange={(shadow) => set({ shadow })} />
      </div>
    </Section>
  );
}
