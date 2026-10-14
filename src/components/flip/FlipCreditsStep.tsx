import { useId } from 'react';
import { NEW, ORIGINAL, type FlipCredits, type FlipLabels, type FlipPart, type FlipProject } from '../../engine/flip';
import type { ImageAsset } from '../../engine/types';
import { MarkupEditor } from '../MarkupEditor';
import { PickFile, Section, Segmented, Slider, Toggle } from '../ui';
import { partName } from './FlipClipsStep';

interface Props {
  project: FlipProject;
  update: (fn: (p: FlipProject) => FlipProject) => void;
  covers: Map<string, ImageAsset>;
  activePart: number;
  onSelectPart: (part: number) => void;
  onCoverFile: (part: number, file: File) => void;
}

const FIELDS: { key: Exclude<keyof FlipCredits, 'story'>; label: string; placeholder: string }[] = [
  { key: 'tag', label: 'Tag', placeholder: 'NEW' },
  { key: 'title', label: 'Title', placeholder: 'Hypnotize' },
  { key: 'artist', label: 'Artist', placeholder: 'The Notorious B.I.G.' },
  { key: 'released', label: 'Released', placeholder: 'March 1997' },
  { key: 'album', label: 'Album', placeholder: 'Life After Death' },
  { key: 'genre', label: 'Genre', placeholder: 'Hip-hop, East Coast hip-hop' },
];

function TextInput(props: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; wide?: boolean }) {
  const id = useId();
  return (
    <label className={`text-field ${props.wide ? 'is-wide' : ''}`} htmlFor={id}>
      <span>{props.label}</span>
      <input id={id} type="text" value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export function FlipCreditsStep({ project, update, covers, activePart, onSelectPart, onCoverFile }: Props) {
  const part = project.parts[activePart];
  const setPart = (patch: Partial<FlipPart>) =>
    update((p) => {
      const parts = [...p.parts] as FlipProject['parts'];
      parts[activePart] = { ...parts[activePart], ...patch };
      return { ...p, parts };
    });
  const setHook = (patch: Partial<FlipProject['hook']>) => update((p) => ({ ...p, hook: { ...p.hook, ...patch } }));
  const setLabel = (key: keyof FlipLabels, value: string) => update((p) => ({ ...p, labels: { ...p.labels, [key]: value } }));
  const cover = part.coverId ? covers.get(part.coverId) : undefined;
  const filled = (c: FlipCredits) => !!c.title.trim() && c.title !== 'Song Title' && c.title !== 'Original Song';

  return (
    <Section
      step={2}
      title="Credits"
      subtitle="Cover, title, artist, release, album, genre and a few words for each"
      done={filled(project.parts[NEW]) && filled(project.parts[ORIGINAL])}
    >
      <Segmented
        ariaLabel="Which track's credits"
        value={activePart}
        onChange={onSelectPart}
        options={[NEW, ORIGINAL].map((k) => ({
          value: k,
          label: partName(k),
          hint: project.parts[k].title.trim() || undefined,
        }))}
      />

      <div className="flip-cover-row">
        <span
          className="flip-cover"
          style={cover ? { backgroundImage: `url("${cover.url}")` } : undefined}
          aria-label={cover ? `${partName(activePart)} cover` : undefined}
          role={cover ? 'img' : undefined}
        >
          {!cover && 'No cover'}
        </span>
        <div className="flip-cover-actions">
          <strong>Album cover</strong>
          <small>{cover ? cover.name : 'Shown above the credits and on the closing card.'}</small>
          <div className="inline-buttons">
            <PickFile accept="image/*" className="btn-ghost sm" onFile={(f) => onCoverFile(activePart, f)}>
              {cover ? 'Replace cover' : 'Upload cover'}
            </PickFile>
            {cover && (
              <button type="button" className="btn-link" onClick={() => setPart({ coverId: null })}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flip-fields">
        {FIELDS.map((f) => (
          <TextInput
            key={f.key}
            label={f.label}
            value={part[f.key]}
            placeholder={activePart === NEW || f.key !== 'tag' ? f.placeholder : 'ORIGINAL'}
            wide={f.key === 'genre'}
            onChange={(v) => setPart({ [f.key]: v })}
          />
        ))}
      </div>
      <div className="field">
        <div className="field-row">
          <label>Story</label>
          <span className="field-value">optional</span>
        </div>
        <MarkupEditor
          value={part.story}
          onChange={(story) => setPart({ story })}
          rows={4}
          placeholder="Hypnotize uses the bassline and groove of Rise (1979)…"
          ariaLabel={`${partName(activePart)} story`}
        />
      </div>

      <div className="text-section">
        <Toggle
          label="Show labels before the details"
          hint={`e.g. “${project.labels.released || 'Released'} March 1997”`}
          checked={project.showLabels}
          onChange={(showLabels) => update((p) => ({ ...p, showLabels }))}
        />
        {project.showLabels && (
          <div className="grid-3">
            <TextInput label="Release label" value={project.labels.released} onChange={(v) => setLabel('released', v)} />
            <TextInput label="Album label" value={project.labels.album} onChange={(v) => setLabel('album', v)} />
            <TextInput label="Genre label" value={project.labels.genre} onChange={(v) => setLabel('genre', v)} />
          </div>
        )}
      </div>

      <div className="text-section">
        <Toggle
          label="Opening line"
          hint="Big text over the first clip before its credits come in"
          checked={project.hook.enabled}
          onChange={(enabled) => setHook({ enabled })}
        />
        {project.hook.enabled && (
          <>
            <MarkupEditor value={project.hook.text} onChange={(text) => setHook({ text })} rows={2} ariaLabel="Opening line" />
            <Slider
              label="Shown for"
              value={project.hook.duration}
              min={0.8}
              max={6}
              step={0.1}
              format={(x) => `${x.toFixed(1)}s`}
              onChange={(duration) => setHook({ duration })}
            />
          </>
        )}
        <p className="note">
          <code>{'{new}'}</code> and <code>{'{original}'}</code> fill in the titles; <code>{'{new-artist}'}</code>,{' '}
          <code>{'{original-year}'}</code> etc. work too.
        </p>
      </div>
    </Section>
  );
}
