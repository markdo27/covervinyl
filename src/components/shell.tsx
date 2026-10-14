/** Pieces shared by both editor modes: top bar, toasts and the export runner. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lut } from '../engine/luts';
import type { Preset } from '../engine/presets';
import type { Ratio } from '../engine/types';
import type { ExportResult } from '../export/types';
import { readPresetFile } from '../lib/presetFiles';
import { ExportDialog, type ExportStatus } from './ExportDialog';

export type Mode = 'cover' | 'reel';

export const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'cover', label: 'Cover Crate', hint: 'Album covers + credits over your clip' },
  { value: 'reel', label: 'Photo Reel', hint: 'Beat-cut photos & clips with an animation on top' },
];

/** Uploaded .cube LUTs, shared between modes. */
export interface LutLibrary {
  custom: Lut[];
  get: (key: string) => Lut | null;
  addFile: (file: File) => Promise<Lut>;
  /** Registers a LUT carried by a preset, reusing an identical one already loaded. */
  adopt: (lut: Omit<Lut, 'key'>) => Lut;
  remove: (key: string) => void;
}

export interface ModeProps {
  active: boolean;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  luts: LutLibrary;
  /** A preset picked in the top bar, waiting to be applied by the editor it belongs to. */
  pendingPreset: Preset | null;
  /** Hands a loaded preset to its editor (switching modes if needed), or clears it. */
  onPreset: (preset: Preset | null) => void;
}

const SaveIcon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
    <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 14v2.5h12V14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LoadIcon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
    <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 14v2.5h12V14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function TopBar(props: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onExport: () => void;
  exporting: boolean;
  onSavePreset: () => void;
  onPreset: (preset: Preset) => void;
  flash: (kind: 'error' | 'info', text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (file: File) => {
    try {
      props.onPreset(await readPresetFile(file));
    } catch (err) {
      props.flash('error', err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          <span />
        </span>
        <span>
          <strong>CoverVinyl</strong>
          <small>Vinyl reels from your own footage</small>
        </span>
      </div>
      <nav className="mode-tabs" role="tablist" aria-label="Editor mode">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={props.mode === m.value}
            className={props.mode === m.value ? 'is-active' : ''}
            title={m.hint}
            onClick={() => props.onModeChange(m.value)}
          >
            {m.label}
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        <button
          type="button"
          className="btn-ghost topbar-btn"
          onClick={props.onSavePreset}
          aria-label="Save preset"
          title="Save your settings as a preset (.json)"
        >
          <SaveIcon />
          <span>Save preset</span>
        </button>
        <button
          type="button"
          className="btn-ghost topbar-btn"
          onClick={() => fileRef.current?.click()}
          aria-label="Load preset"
          title="Load a preset (.json)"
        >
          <LoadIcon />
          <span>Load preset</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void onFile(file);
          }}
        />
        <button type="button" className="btn-primary" onClick={props.onExport} disabled={props.exporting}>
          Export
        </button>
      </div>
    </header>
  );
}

export function useNotice() {
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const flash = useCallback((kind: 'error' | 'info', text: string) => setNotice({ kind, text }), []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), notice.kind === 'error' ? 8000 : 3500);
    return () => clearTimeout(id);
  }, [notice]);
  const toast = notice && (
    <div className={`toast ${notice.kind === 'error' ? 'is-error' : ''}`} role="status" onClick={() => setNotice(null)}>
      {notice.text}
    </div>
  );
  return { flash, toast };
}

type Job = (signal: AbortSignal, onProgress: (progress: number, label: string) => void) => Promise<ExportResult>;

/** Runs an export with a progress dialog, cancel button and result download. */
export function useExportRunner(flash: (kind: 'error' | 'info', text: string) => void) {
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async (opts: { filePrefix: string; ratio: Ratio; firstLabel?: string; prepare?: () => Promise<void>; job: Job }) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ phase: 'running', progress: 0, label: opts.firstLabel ?? 'Preparing…' });
    const started = performance.now();
    try {
      await opts.prepare?.();
      const result = await opts.job(controller.signal, (progress, label) => {
        if (!controller.signal.aborted) setStatus({ phase: 'running', progress, label });
      });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      setStatus({
        phase: 'done',
        result,
        fileName: `${opts.filePrefix}-${opts.ratio.replace(':', 'x')}-${stamp}.${result.extension}`,
        seconds: (performance.now() - started) / 1000,
      });
    } catch (err) {
      if ((err instanceof Error && err.name === 'ExportAbortedError') || controller.signal.aborted) {
        setStatus(null);
        flash('info', 'Export cancelled.');
      } else {
        console.error(err);
        setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      abortRef.current = null;
    }
  };

  const dialog = status && (
    <ExportDialog status={status} onCancel={() => abortRef.current?.abort()} onClose={() => setStatus(null)} />
  );
  return { run, exporting: status?.phase === 'running', dialog };
}

/** Warns before leaving the page while there are uploads that would be lost. */
export function useUnsavedWarning(hasWork: boolean) {
  useEffect(() => {
    if (!hasWork) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasWork]);
}
