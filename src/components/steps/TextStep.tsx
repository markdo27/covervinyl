import { useState } from 'react';
import { morphSection, newSection } from '../../engine/sections';
import type { ImageAsset, Project, Slide, TextSection } from '../../engine/types';
import { MarkupEditor } from '../MarkupEditor';
import { ColorField, Section, Slider, Toggle } from '../ui';

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
  const [showStyle, setShowStyle] = useState(false);
  const morphId = morphSection(project.sections)?.id;

  const setSection = (id: string, patch: Partial<TextSection>) =>
    update((p) => ({ ...p, sections: p.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const setSlide = (index: number, fn: (s: Slide) => Slide) =>
    update((p) => ({ ...p, slides: p.slides.map((s, k) => (k === index ? fn(s) : s)) }));

  const addSection = (mode: TextSection['mode']) =>
    update((p) => ({ ...p, sections: [...p.sections, newSection(mode, p.sections)] }));

  const removeSection = (id: string) =>
    update((p) => ({
      ...p,
      sections: p.sections.filter((s) => s.id !== id),
      slides: p.slides.map((slide) => {
        const texts = { ...slide.texts };
        delete texts[id];
        return { ...slide, texts };
      }),
    }));

  const moveSection = (index: number, dir: -1 | 1) =>
    update((p) => {
      const j = index + dir;
      if (j < 0 || j >= p.sections.length) return p;
      const sections = [...p.sections];
      [sections[index], sections[j]] = [sections[j], sections[index]];
      return { ...p, sections };
    });

  // Switching mode carries the text over so nothing typed is lost.
  const changeMode = (section: TextSection, mode: TextSection['mode']) =>
    update((p) => {
      if (mode === 'shared') {
        const firstText = p.slides.map((s) => s.texts[section.id] ?? '').find((x) => x.trim()) ?? '';
        return {
          ...p,
          sections: p.sections.map((s) => (s.id === section.id ? { ...s, mode, text: s.text.trim() ? s.text : firstText } : s)),
        };
      }
      return {
        ...p,
        sections: p.sections.map((s) => (s.id === section.id ? { ...s, mode } : s)),
        slides: p.slides.map((slide) =>
          slide.texts[section.id]?.trim() ? slide : { ...slide, texts: { ...slide.texts, [section.id]: section.text } },
        ),
      };
    });

  return (
    <Section step={3} title="Text" subtitle="Add, remove and edit the text under the covers">
      <ColorField
        label="Text colour (default for every section)"
        value={t.color}
        fallback="#ffffff"
        onChange={(color) => set({ color: color ?? '#ffffff' })}
      />

      <div className="markup-help">
        <code>**bold**</code> <code>*italic*</code> <code>~light~</code> <code># headline</code>
        <code>{'{#e2402f}colour{/}'}</code>
        <span>Select text and use the buttons — the coloured “A” colours just the selected words.</span>
      </div>

      {project.sections.length === 0 && (
        <p className="empty-note">No text — only the covers will show. Add a section below if you want some.</p>
      )}

      {project.sections.map((section, i) => (
        <div key={section.id} className="text-section">
          <div className="text-section-head">
            <input
              className="section-name"
              value={section.name}
              aria-label="Section name"
              onChange={(e) => setSection(section.id, { name: e.target.value })}
            />
            <select
              className="section-mode"
              value={section.mode}
              aria-label={`${section.name} mode`}
              onChange={(e) => changeMode(section, e.target.value as TextSection['mode'])}
            >
              <option value="slide">Different on each slide</option>
              <option value="shared">Same on every slide</option>
            </select>
            <div className="section-actions">
              <button
                type="button"
                className="icon-btn"
                title="Move up"
                aria-label={`Move ${section.name} up`}
                disabled={i === 0}
                onClick={() => moveSection(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Move down"
                aria-label={`Move ${section.name} down`}
                disabled={i === project.sections.length - 1}
                onClick={() => moveSection(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-btn is-danger"
                title={`Remove “${section.name}”`}
                aria-label={`Remove ${section.name}`}
                onClick={() => removeSection(section.id)}
              >
                ✕
              </button>
            </div>
          </div>

          {section.mode === 'shared' ? (
            <MarkupEditor
              ariaLabel={`${section.name} text`}
              value={section.text}
              rows={Math.min(5, Math.max(1, section.text.split('\n').length))}
              placeholder="Shown on every slide, e.g. **your name** archives #01"
              onChange={(text) => setSection(section.id, { text })}
            />
          ) : (
            <div className="slide-texts">
              {project.slides.map((slide, k) => {
                const img = slide.coverId ? images.get(slide.coverId) : undefined;
                const value = slide.texts[section.id] ?? '';
                const isMorph = section.id === morphId;
                return (
                  <div
                    key={slide.id}
                    className={`slide-text ${k === activeSlide ? 'is-active' : ''}`}
                    onFocus={() => onSelectSlide(k)}
                  >
                    <div className="slide-text-head">
                      <span className="mini-thumb" style={img ? { backgroundImage: `url("${img.url}")` } : undefined}>
                        {k + 1}
                      </span>
                      <strong>Slide {k + 1}</strong>
                      {isMorph && <MorphToggle slide={slide} value={value} onChange={(morphFrom) => setSlide(k, (s) => ({ ...s, morphFrom }))} />}
                    </div>
                    {isMorph && slide.morphFrom !== '' && (
                      <div className="morph-from">
                        <span className="morph-label">Starts as…</span>
                        <MarkupEditor
                          ariaLabel={`Slide ${k + 1} starting text`}
                          value={slide.morphFrom}
                          rows={1}
                          onChange={(morphFrom) => setSlide(k, (s) => ({ ...s, morphFrom: morphFrom || ' ' }))}
                        />
                        <span className="morph-label">…and morphs into</span>
                      </div>
                    )}
                    <MarkupEditor
                      ariaLabel={`${section.name}, slide ${k + 1}`}
                      value={value}
                      rows={Math.min(7, Math.max(2, value.split('\n').length))}
                      placeholder="Leave empty to show nothing on this slide"
                      onChange={(text) => setSlide(k, (s) => ({ ...s, texts: { ...s.texts, [section.id]: text } }))}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid-2">
            <Slider
              label="Size"
              value={section.scale}
              min={0.5}
              max={2.5}
              step={0.05}
              format={(x) => `${x.toFixed(2)}×`}
              onChange={(scale) => setSection(section.id, { scale })}
            />
            <Slider
              label="Space above"
              value={section.gap}
              min={0}
              max={5}
              step={0.1}
              format={(x) => `${x.toFixed(1)} lines`}
              onChange={(gap) => setSection(section.id, { gap })}
            />
          </div>
          <ColorField
            label="Colour"
            value={section.color}
            fallback={t.color}
            defaultLabel="Default"
            onChange={(color) => setSection(section.id, { color })}
          />
        </div>
      ))}

      <div className="add-section">
        <button type="button" className="btn-ghost sm" onClick={() => addSection('slide')}>
          + Text per slide
        </button>
        <button type="button" className="btn-ghost sm" onClick={() => addSection('shared')}>
          + Same text on every slide
        </button>
      </div>

      <button type="button" className="btn-link" onClick={() => setShowStyle(!showStyle)} aria-expanded={showStyle}>
        {showStyle ? '▾' : '▸'} Text style
      </button>
      {showStyle && (
        <>
          <div className="grid-2">
            <Slider label="Text size" value={t.size} min={0.02} max={0.08} step={0.001} format={(x) => `${Math.round(x * 1080)}px`} onChange={(size) => set({ size })} />
            <Slider label="Headline size" value={t.headlineScale} min={1} max={3} step={0.05} format={(x) => `${x.toFixed(2)}×`} onChange={(headlineScale) => set({ headlineScale })} />
            <Slider label="Line height" value={t.lineHeight} min={0.9} max={2} step={0.01} format={(x) => x.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
            <Slider label="Letter spacing" value={t.tracking} min={-0.08} max={0.2} step={0.005} format={(x) => `${(x * 100).toFixed(1)}%`} onChange={(tracking) => set({ tracking })} />
          </div>
          <div className="toggles">
            <Toggle label="Soft shadow" checked={t.shadow} onChange={(shadow) => set({ shadow })} />
          </div>
        </>
      )}
    </Section>
  );
}

function MorphToggle({ slide, value, onChange }: { slide: Slide; value: string; onChange: (v: string) => void }) {
  const on = slide.morphFrom !== '';
  return (
    <label className="mini-toggle" title="Start with different text and morph into this slide's text (like the intro title)">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          if (!e.target.checked) onChange('');
          else onChange(value.split('\n')[0] || ' ');
        }}
      />
      <span>Morph intro</span>
    </label>
  );
}
