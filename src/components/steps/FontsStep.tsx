import { BUILT_IN_FONTS, FONT_ACCEPT, fontStack, userFontKey, type UserFontFace } from '../../engine/fonts';
import type { Project } from '../../engine/types';
import { FileDrop, Section } from '../ui';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  fonts: UserFontFace[];
  onFontFiles: (files: File[]) => void;
  onRemoveFamily: (family: string) => void;
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function describeFace(f: UserFontFace): string {
  const w = f.weight.includes(' ') ? `variable ${f.weight.replace(' ', '–')}` : f.weight;
  return `${w}${f.style === 'italic' ? ' italic' : ''}`;
}

export function FontsStep({ project, update, fonts, onFontFiles, onRemoveFamily }: Props) {
  const t = project.text;
  const set = (patch: Partial<Project['text']>) => update((p) => ({ ...p, text: { ...p.text, ...patch } }));
  const families = [...new Set(fonts.map((f) => f.family))];
  const options = [
    ...families.map((family) => ({ key: userFontKey(family), label: `${family} (uploaded)` })),
    ...BUILT_IN_FONTS.map((f) => ({ key: f.key, label: f.label })),
  ];
  const usesUserFont = t.family.startsWith('user:') || t.headlineFamily.startsWith('user:');

  return (
    <Section step={4} title="Fonts" subtitle="Upload your own typeface" done={usesUserFont}>
      <FileDrop
        accept={FONT_ACCEPT}
        multiple
        title="Upload font files"
        hint="TTF, OTF, WOFF, WOFF2 · add Regular, Bold, Italic… together"
        icon={<span className="big-icon">Aa</span>}
        onFiles={onFontFiles}
      />

      {families.length > 0 && (
        <ul className="font-list">
          {families.map((family) => {
            const faces = fonts.filter((f) => f.family === family);
            const key = userFontKey(family);
            return (
              <li key={family}>
                <span className="font-sample" style={{ fontFamily: fontStack(key) }}>
                  Aa
                </span>
                <span className="font-meta">
                  <strong>{family}</strong>
                  <small>{faces.map(describeFace).join(' · ')}</small>
                </span>
                <button type="button" className="btn-ghost sm" onClick={() => set({ family: key, headlineFamily: key })}>
                  Use
                </button>
                <button type="button" className="icon-btn is-danger" title="Remove font" onClick={() => onRemoveFamily(family)}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid-2">
        <label className="select-field">
          <span>Text font</span>
          <select value={t.family} onChange={(e) => set({ family: e.target.value })}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <span>Headline font</span>
          <select value={t.headlineFamily} onChange={(e) => set({ headlineFamily: e.target.value })}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid-3">
        {(['light', 'regular', 'bold'] as const).map((k) => (
          <label key={k} className="select-field">
            <span>{k === 'light' ? '~Light~ weight' : k === 'bold' ? '**Bold** weight' : 'Regular weight'}</span>
            <select
              value={t.weights[k]}
              onChange={(e) => set({ weights: { ...t.weights, [k]: Number(e.target.value) } })}
            >
              {WEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="note">
        Tip: upload the Bold and Italic files of your font too — otherwise the browser fakes them.
      </p>
    </Section>
  );
}
