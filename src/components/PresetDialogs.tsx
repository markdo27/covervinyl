import { useEffect, useId, useState } from 'react';
import { presetGroups, type Preset, type PresetGroup } from '../engine/presets';
import { formatBytes } from '../lib/media';
import { downloadPreset, embeddedSize } from '../lib/presetFiles';
import { MODES } from './shell';
import { Toggle } from './ui';

export type AttachmentKey = 'fonts' | 'lut' | 'logo' | 'overlay';

/** One of the user's own files that a preset can carry. */
export interface Attachment {
  key: AttachmentKey;
  label: string;
  detail: string;
  bytes: number;
}

function useEscape(onClose: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, enabled]);
}

const MEDIA_NOTE: Record<Preset['mode'], string> = {
  cover: 'Your clip and covers',
  reel: 'Your photos, clips and music',
  flip: 'Your clips and covers',
};

const modeLabel = (mode: Preset['mode']) => MODES.find((m) => m.value === mode)?.label ?? mode;

export function SavePresetDialog(props: {
  mode: Preset['mode'];
  defaultName: string;
  attachments: Attachment[];
  onSave: (name: string, include: Set<AttachmentKey>) => Promise<void>;
  onClose: () => void;
}) {
  const nameId = useId();
  const [name, setName] = useState(props.defaultName);
  const [include, setInclude] = useState(() => new Set(props.attachments.map((a) => a.key)));
  const [busy, setBusy] = useState(false);
  useEscape(props.onClose, !busy);

  const estimate = 4096 + props.attachments.filter((a) => include.has(a.key)).reduce((sum, a) => sum + embeddedSize(a.bytes), 0);

  const save = async () => {
    setBusy(true);
    try {
      await props.onSave(name, include);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="save-preset-title">
      <form
        className="modal preset-modal"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="save-preset-title">Save preset</h2>
        <p className="note">
          Saves your {modeLabel(props.mode)} {props.mode === 'reel' ? 'settings' : 'settings and text'} as a <code>.json</code>{' '}
          file. Open it any time with <strong>Load preset</strong>. {MEDIA_NOTE[props.mode]} aren’t included.
        </p>
        <label className="preset-name" htmlFor={nameId}>
          <span>Preset name</span>
          <input id={nameId} type="text" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        {props.attachments.length > 0 && (
          <div className="preset-options">
            <span className="preset-options-title">Include your files, so the preset works on any device</span>
            {props.attachments.map((a) => (
              <Toggle
                key={a.key}
                label={`${a.label} · ${formatBytes(a.bytes)}`}
                hint={a.detail}
                checked={include.has(a.key)}
                onChange={(on) =>
                  setInclude((old) => {
                    const next = new Set(old);
                    if (on) next.add(a.key);
                    else next.delete(a.key);
                    return next;
                  })
                }
              />
            ))}
          </div>
        )}
        <div className="modal-actions">
          <span className="preset-size">≈ {formatBytes(estimate)}</span>
          <button type="button" className="btn-ghost" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save .json'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** What the preset brings along for a group, shown under its toggle. */
function groupExtra(preset: Preset, group: PresetGroup): string | null {
  const f = preset.files;
  switch (group) {
    case 'style':
      if (!f.fonts?.length) return null;
      return f.fonts.length === 1 ? `Includes font “${f.fonts[0].name}”` : `Includes ${f.fonts.length} font files`;
    case 'look':
      if (f.lut) return `Includes LUT “${f.lut.name}”`;
      return preset.settings.post.lut.startsWith('custom:') ? 'Its own LUT wasn’t saved with it — the look will be off' : null;
    case 'endCard':
      return f.logo ? `Includes logo “${f.logo.name}”` : null;
    case 'overlay':
      if (!f.overlay?.length) return 'Settings only — keeps your current animation';
      return f.overlay.length > 1 ? `Includes ${f.overlay.length}-frame sequence` : `Includes “${f.overlay[0].name}”`;
    case 'slides':
      return preset.mode === 'cover' ? `${preset.settings.slides.length} slide${preset.settings.slides.length === 1 ? '' : 's'}` : null;
    default:
      return null;
  }
}

export function LoadPresetDialog(props: {
  preset: Preset;
  onApply: (groups: Set<PresetGroup>) => Promise<void>;
  onClose: () => void;
}) {
  const { preset } = props;
  const groups = presetGroups(preset.mode);
  const [chosen, setChosen] = useState(() => new Set<PresetGroup>(groups.map((g) => g.key)));
  const [busy, setBusy] = useState(false);
  useEscape(props.onClose, !busy);

  const saved = preset.savedAt ? new Date(preset.savedAt) : null;
  const apply = async () => {
    setBusy(true);
    try {
      await props.onApply(chosen);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="load-preset-title">
      <form
        className="modal preset-modal"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <h2 id="load-preset-title">Load “{preset.name}”</h2>
        <p className="note">
          {modeLabel(preset.mode)} preset
          {saved && !Number.isNaN(saved.getTime()) ? ` · saved ${saved.toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ''}.
          Choose what to apply — {MEDIA_NOTE[preset.mode].toLowerCase()} stay as they are.
        </p>
        <div className="preset-options">
          {groups.map((g) => {
            const extra = groupExtra(preset, g.key);
            return (
              <Toggle
                key={g.key}
                label={g.label}
                hint={extra ? `${g.detail}. ${extra}.` : `${g.detail}.`}
                checked={chosen.has(g.key)}
                onChange={(on) =>
                  setChosen((old) => {
                    const next = new Set(old);
                    if (on) next.add(g.key);
                    else next.delete(g.key);
                    return next;
                  })
                }
              />
            );
          })}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || chosen.size === 0}>
            {busy ? 'Applying…' : 'Apply preset'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Save / load preset flow for one editor: the save dialog, and the load
 * dialog for a preset picked in the top bar (which may have switched modes).
 */
export function usePresetDialogs(opts: {
  mode: Preset['mode'];
  active: boolean;
  pending: Preset | null;
  onPreset: (preset: Preset | null) => void;
  flash: (kind: 'error' | 'info', text: string) => void;
  getAttachments: () => Attachment[];
  build: (name: string, include: Set<AttachmentKey>) => Promise<Preset>;
  /** Applies the chosen parts; returns warnings about anything that couldn't be applied. */
  apply: (preset: Preset, groups: Set<PresetGroup>) => Promise<string[]>;
}) {
  const { flash, onPreset } = opts;
  const [saveFiles, setSaveFiles] = useState<Attachment[] | null>(null);
  const [lastName, setLastName] = useState('');
  const pending = opts.active && opts.pending?.mode === opts.mode ? opts.pending : null;
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const dialogs = (
    <>
      {saveFiles && (
        <SavePresetDialog
          mode={opts.mode}
          defaultName={lastName || `My ${modeLabel(opts.mode)} preset`}
          attachments={saveFiles}
          onSave={async (name, include) => {
            try {
              const fileName = downloadPreset(await opts.build(name, include));
              setLastName(name.trim());
              setSaveFiles(null);
              flash('info', `Saved preset “${fileName}”.`);
            } catch (err) {
              flash('error', `Couldn't save the preset: ${message(err)}`);
            }
          }}
          onClose={() => setSaveFiles(null)}
        />
      )}
      {pending && (
        <LoadPresetDialog
          key={pending.savedAt + pending.name}
          preset={pending}
          onApply={async (groups) => {
            try {
              const warnings = await opts.apply(pending, groups);
              setLastName(pending.name);
              onPreset(null);
              if (warnings.length) flash('error', `Applied “${pending.name}”, but: ${warnings.join(' ')}`);
              else flash('info', `Applied preset “${pending.name}”.`);
            } catch (err) {
              flash('error', `Couldn't apply the preset: ${message(err)}`);
            }
          }}
          onClose={() => onPreset(null)}
        />
      )}
    </>
  );

  return { openSave: () => setSaveFiles(opts.getAttachments()), dialogs };
}
