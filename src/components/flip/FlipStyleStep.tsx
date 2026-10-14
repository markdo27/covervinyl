import type { FlipLayout, FlipProject } from '../../engine/flip';
import type { TextStyle } from '../../engine/types';
import { ColorField, Section, Segmented, Slider, Toggle } from '../ui';

interface Props {
  project: FlipProject;
  update: (fn: (p: FlipProject) => FlipProject) => void;
}

export function FlipStyleStep({ project, update }: Props) {
  const l = project.layout;
  const t = project.text;
  const setLayout = (patch: Partial<FlipLayout>) => update((p) => ({ ...p, layout: { ...p.layout, ...patch } }));
  const setText = (patch: Partial<TextStyle>) => update((p) => ({ ...p, text: { ...p.text, ...patch } }));

  return (
    <Section step={3} title="Layout & text style" subtitle="Where the credits sit, sizes and colours">
      <div className="field">
        <div className="field-row">
          <label>Credits position</label>
        </div>
        <Segmented
          ariaLabel="Credits position"
          value={l.position}
          onChange={(position) => setLayout({ position })}
          options={[
            { value: 'top', label: 'Top' },
            { value: 'middle', label: 'Middle' },
            { value: 'bottom', label: 'Bottom' },
          ]}
        />
      </div>
      <div className="toggles">
        <Toggle
          label="Keep text inside Instagram's safe zone"
          hint="Clear of the top bar, the like / share buttons and the caption — long text shrinks to fit"
          checked={l.safeArea}
          onChange={(safeArea) => setLayout({ safeArea })}
        />
        <Toggle label="Show the album cover" checked={l.cover} onChange={(cover) => setLayout({ cover })} />
      </div>

      <div className="grid-2">
        {l.cover && (
          <Slider
            label="Cover size"
            value={l.coverSize}
            min={0.12}
            max={0.5}
            step={0.01}
            format={(x) => `${Math.round(x * 100)}%`}
            onChange={(coverSize) => setLayout({ coverSize })}
          />
        )}
        <Slider label="Text size" value={t.size} min={0.02} max={0.07} step={0.001} format={(x) => `${Math.round(x * 1080)}px`} onChange={(size) => setText({ size })} />
        <Slider label="Title size" value={t.headlineScale} min={1} max={3} step={0.05} format={(x) => `${x.toFixed(2)}×`} onChange={(headlineScale) => setText({ headlineScale })} />
        <Slider label="Story size" value={l.storyScale} min={0.5} max={1.2} step={0.01} format={(x) => `${Math.round(x * 100)}%`} onChange={(storyScale) => setLayout({ storyScale })} />
        <Slider label="Line height" value={t.lineHeight} min={0.9} max={2} step={0.01} format={(x) => x.toFixed(2)} onChange={(lineHeight) => setText({ lineHeight })} />
        <Slider label="Text backdrop" value={l.scrim} min={0} max={1} step={0.01} format={(x) => (x <= 0 ? 'Off' : `${Math.round(x * 100)}%`)} onChange={(scrim) => setLayout({ scrim })} />
      </div>

      <ColorField label="Text colour" value={t.color} fallback="#ffffff" onChange={(color) => setText({ color: color ?? '#ffffff' })} />
      <ColorField label="Tag colour" value={project.accent} fallback="#e2402f" onChange={(accent) => update((p) => ({ ...p, accent: accent ?? '#e2402f' }))} />

      <div className="toggles">
        <Toggle label="Soft shadow" checked={t.shadow} onChange={(shadow) => setText({ shadow })} />
        <Toggle
          label="Look & grain on the text too"
          hint="Off keeps the text crisp while the clips get the colour look"
          checked={l.gradeText}
          onChange={(gradeText) => setLayout({ gradeText })}
        />
      </div>
    </Section>
  );
}
