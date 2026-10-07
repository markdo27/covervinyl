import { useState } from 'react';
import type { ImageAsset, Project, Slide } from '../../engine/types';
import { MarkupEditor } from '../MarkupEditor';
import { Section, Slider, Toggle } from '../ui';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  images: Map<string, ImageAsset>;
  activeSlide: number;
  onSelectSlide: (index: number) => void;
}

export function TextStep({ project, update, images, activeSlide, onSelectSlide }: Props) {
  const t = project.text;
  const set = (patch: Partial<Project['text']>) => update((p) => ({ ...p, text: { ...p.text, ...patch } }));
  const setSlide = (i: number, patch: Partial<Slide>) =>
    update((p) => ({ ...p, slides: p.slides.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const [showStyle, setShowStyle] = useState(false);

  return (
    <Section step={3} title="Text" subtitle="Edit what's written under each cover">
      <div className="markup-help">
        <code>**bold**</code> <code>*italic*</code> <code>~light~</code> <code># headline</code>
        <span>Select text and use the buttons, or type the markers.</span>
      </div>

      <div className="slide-texts">
        {project.slides.map((slide, i) => {
          const img = slide.coverId ? images.get(slide.coverId) : undefined;
          return (
            <div key={slide.id} className={`slide-text ${i === activeSlide ? 'is-active' : ''}`} onFocus={() => onSelectSlide(i)}>
              <div className="slide-text-head">
                <span className="mini-thumb" style={img ? { backgroundImage: `url("${img.url}")` } : undefined}>
                  {i + 1}
                </span>
                <strong>Slide {i + 1}</strong>
                <MorphToggle slide={slide} onChange={(morphFrom) => setSlide(i, { morphFrom })} />
              </div>
              {slide.morphFrom !== '' && (
                <div className="morph-from">
                  <span className="morph-label">Starts as…</span>
                  <MarkupEditor
                    ariaLabel={`Slide ${i + 1} starting text`}
                    value={slide.morphFrom}
                    rows={1}
                    onChange={(morphFrom) => setSlide(i, { morphFrom: morphFrom || ' ' })}
                  />
                  <span className="morph-label">…and morphs into</span>
                </div>
              )}
              <MarkupEditor
                ariaLabel={`Slide ${i + 1} text`}
                value={slide.text}
                rows={Math.min(7, Math.max(2, slide.text.split('\n').length))}
                onChange={(text) => setSlide(i, { text })}
              />
            </div>
          );
        })}
      </div>

      <div className="field">
        <div className="field-row">
          <label>Footer (shown on every slide)</label>
        </div>
        <MarkupEditor
          ariaLabel="Footer text"
          value={project.footer}
          rows={1}
          placeholder="e.g. **your name** archives #01"
          onChange={(footer) => update((p) => ({ ...p, footer }))}
        />
      </div>

      <button type="button" className="btn-link" onClick={() => setShowStyle(!showStyle)} aria-expanded={showStyle}>
        {showStyle ? '▾' : '▸'} Text style
      </button>
      {showStyle && (
        <>
          <div className="grid-2">
            <Slider label="Text size" value={t.size} min={0.02} max={0.08} step={0.001} format={(x) => `${Math.round(x * 1080)}px`} onChange={(size) => set({ size })} />
            <Slider label="Headline size" value={t.headlineScale} min={1} max={3} step={0.05} format={(x) => `${x.toFixed(2)}×`} onChange={(headlineScale) => set({ headlineScale })} />
            <Slider label="Footer size" value={t.footerScale} min={0.5} max={1.5} step={0.05} format={(x) => `${x.toFixed(2)}×`} onChange={(footerScale) => set({ footerScale })} />
            <Slider label="Line height" value={t.lineHeight} min={0.9} max={2} step={0.01} format={(x) => x.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
            <Slider label="Letter spacing" value={t.tracking} min={-0.08} max={0.2} step={0.005} format={(x) => `${(x * 100).toFixed(1)}%`} onChange={(tracking) => set({ tracking })} />
            <Slider label="Footer gap" value={project.footerGap} min={0} max={5} step={0.1} format={(x) => `${x.toFixed(1)} lines`} onChange={(footerGap) => update((p) => ({ ...p, footerGap }))} />
          </div>
          <div className="toggles inline">
            <label className="color-field">
              <input type="color" value={t.color} onChange={(e) => set({ color: e.target.value })} />
              <span>Text colour</span>
            </label>
            <Toggle label="Soft shadow" checked={t.shadow} onChange={(shadow) => set({ shadow })} />
          </div>
        </>
      )}
    </Section>
  );
}

function MorphToggle({ slide, onChange }: { slide: Slide; onChange: (v: string) => void }) {
  const on = slide.morphFrom !== '';
  return (
    <label className="mini-toggle" title="Start with different text and morph into this slide's text (like the intro title)">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          if (!e.target.checked) onChange('');
          else onChange(slide.text.split('\n')[0] || ' ');
        }}
      />
      <span>Morph intro</span>
    </label>
  );
}
