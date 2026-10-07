import { useEffect, useMemo, useState } from 'react';
import type { ExportResult } from '../export';
import { formatBytes } from '../lib/media';

export type ExportStatus =
  | { phase: 'running'; progress: number; label: string }
  | { phase: 'done'; result: ExportResult; fileName: string; seconds: number }
  | { phase: 'error'; message: string };

interface Props {
  status: ExportStatus;
  onCancel: () => void;
  onClose: () => void;
}

export function ExportDialog({ status, onCancel, onClose }: Props) {
  const url = useMemo(() => (status.phase === 'done' ? URL.createObjectURL(status.result.blob) : null), [status]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const [shareError, setShareError] = useState<string | null>(null);
  const file = useMemo(
    () => (status.phase === 'done' ? new File([status.result.blob], status.fileName, { type: status.result.mimeType }) : null),
    [status],
  );
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && status.phase !== 'running') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status.phase, onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="modal">
        {status.phase === 'running' && (
          <>
            <h2 id="export-title">Exporting your video</h2>
            <div className="progress" aria-hidden>
              <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
            </div>
            <p className="progress-label">
              <span>{status.label}</span>
              <strong>{Math.round(status.progress * 100)}%</strong>
            </p>
            <p className="note">Keep this tab open until it finishes.</p>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {status.phase === 'done' && url && (
          <>
            <h2 id="export-title">Your video is ready</h2>
            <video className="result-video" src={url} controls playsInline loop autoPlay muted />
            <dl className="result-meta">
              <div>
                <dt>File</dt>
                <dd>
                  {status.result.extension.toUpperCase()} · {formatBytes(status.result.blob.size)}
                </dd>
              </div>
              <div>
                <dt>Codecs</dt>
                <dd>
                  {status.result.videoCodec}
                  {status.result.audioCodec ? ` + ${status.result.audioCodec}` : ' · no audio'}
                </dd>
              </div>
              <div>
                <dt>Took</dt>
                <dd>{status.seconds.toFixed(1)}s</dd>
              </div>
            </dl>
            {status.result.notes.length > 0 && (
              <ul className="result-notes">
                {status.result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {shareError && <p className="error-text">{shareError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Close
              </button>
              {canShare && file && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    navigator.share({ files: [file], title: 'CoverVinyl video' }).catch((err: unknown) => {
                      if (err instanceof Error && err.name !== 'AbortError') setShareError(err.message);
                    })
                  }
                >
                  Share…
                </button>
              )}
              <a className="btn-primary" href={url} download={status.fileName}>
                Download
              </a>
            </div>
          </>
        )}

        {status.phase === 'error' && (
          <>
            <h2 id="export-title">Export failed</h2>
            <p className="error-text">{status.message}</p>
            <p className="note">
              Try the “Real-time recording” encoder in step 5, a lower resolution, or a recent Chrome / Edge / Safari.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={onClose}>
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
