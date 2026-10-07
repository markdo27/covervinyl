import { formatTime } from '../../engine/timeline';
import type { Project, VideoAsset } from '../../engine/types';
import { formatBytes } from '../../lib/media';
import { FileDrop, Section, Slider, Toggle } from '../ui';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  video: VideoAsset | null;
  onVideoFile: (file: File) => void;
  onRemoveVideo: () => void;
  editLength: number;
}

export function VideoStep({ project, update, video, onVideoFile, onRemoveVideo, editLength }: Props) {
  const v = project.video;
  const set = (patch: Partial<Project['video']>) => update((p) => ({ ...p, video: { ...p.video, ...patch } }));
  const usable = video ? Math.max(0, video.duration - v.start) : 0;

  return (
    <Section step={1} title="Recorded video" subtitle="Your background clip" done={!!video}>
      {video ? (
        <div className="asset-card">
          <div className="asset-icon" aria-hidden>
            ▶
          </div>
          <div className="asset-meta">
            <strong title={video.name}>{video.name}</strong>
            <small>
              {formatTime(video.duration)} · {video.width}×{video.height} · {formatBytes(video.file.size)}
            </small>
          </div>
          <div className="asset-actions">
            <FileDrop compact accept="video/*,.mov,.mp4,.webm,.m4v" title="Replace" onFiles={(f) => onVideoFile(f[0])} />
            <button type="button" className="btn-ghost" onClick={onRemoveVideo}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <FileDrop
          accept="video/*,.mov,.mp4,.webm,.m4v"
          title="Upload your recorded video"
          hint="MP4, MOV or WebM · drag & drop or click"
          icon={<span className="big-icon">🎞️</span>}
          onFiles={(f) => onVideoFile(f[0])}
        />
      )}

      {video && (
        <>
          <Slider
            label="Start at"
            value={Math.min(v.start, Math.max(0, video.duration - 0.5))}
            min={0}
            max={Math.max(0, video.duration - 0.5)}
            step={0.1}
            format={(x) => `${x.toFixed(1)}s`}
            onChange={(start) => set({ start })}
          />
          {usable > 0 && usable < editLength && (
            <p className="note">
              Your edit is {editLength.toFixed(1)}s but the clip has {usable.toFixed(1)}s from this point —{' '}
              {v.loop ? 'it will loop.' : 'it will hold the last frame.'}
            </p>
          )}
        </>
      )}

      <div className="grid-2">
        <Slider label="Zoom" value={v.zoom} min={1} max={2.5} step={0.01} format={(x) => `${Math.round(x * 100)}%`} onChange={(zoom) => set({ zoom })} />
        <Slider label="Darken" value={v.dim} min={0} max={0.8} step={0.01} format={(x) => `${Math.round(x * 100)}%`} onChange={(dim) => set({ dim })} />
        <Slider label="Position ↔" value={v.panX} min={-1} max={1} step={0.01} format={(x) => x.toFixed(2)} onChange={(panX) => set({ panX })} />
        <Slider label="Position ↕" value={v.panY} min={-1} max={1} step={0.01} format={(x) => x.toFixed(2)} onChange={(panY) => set({ panY })} />
      </div>
      <div className="toggles">
        <Toggle label="Include the clip's audio" checked={v.audio} onChange={(audio) => set({ audio })} />
        <Toggle label="Loop if the clip is shorter" checked={v.loop} onChange={(loop) => set({ loop })} />
      </div>
    </Section>
  );
}
