/** Pieces shared by both editor modes: top bar, toasts and the export runner. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lut } from '../engine/luts';
import type { Ratio } from '../engine/types';
import type { ExportResult } from '../export/types';
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
  remove: (key: string) => void;
}

export interface ModeProps {
  active: boolean;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  luts: LutLibrary;
}

export function TopBar(props: { mode: Mode; onModeChange: (m: Mode) => void; onExport: () => void; exporting: boolean }) {
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
      <button type="button" className="btn-primary" onClick={props.onExport} disabled={props.exporting}>
        Export
      </button>
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
