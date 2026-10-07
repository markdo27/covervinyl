import { OUTPUT_SIZES } from '../../engine/defaults';
import { stripMarkup } from '../../engine/markup';
import { fitDurations, formatTime, type Timeline } from '../../engine/timeline';
import type { ImageAsset, Project, VideoAsset } from '../../engine/types';
import { MarkupEditor } from '../MarkupEditor';
import { NumberField, PickFile, Section, Segmented, Slider, Toggle } from '../ui';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  images: Map<string, ImageAsset>;
  video: VideoAsset | null;
  timeline: Timeline;
  onLogoFile: (file: File) => void;
  onExport: () => void;
  exporting: boolean;
}

export function ExportStep({ project, update, images, video, timeline, onLogoFile, onExport, exporting }: Props) {
  const e = project.endCard;
  const m = project.motion;
  const setEnd = (patch: Partial<Project['endCard']>) => update((p) => ({ ...p, endCard: { ...p.endCard, ...patch } }));
  const setMotion = (patch: Partial<Project['motion']>) => update((p) => ({ ...p, motion: { ...p.motion, ...patch } }));
  const setExport = (patch: Partial<Project['export']>) => update((p) => ({ ...p, export: { ...p.export, ...patch } }));
  const logo = e.logoId ? images.get(e.logoId) : undefined;
  const clipLength = video ? Math.max(0, video.duration - project.video.start) : 0;
  const [w, h] = OUTPUT_SIZES[project.ratio][project.export.resolution];

  return (
    <Section step={5} title="Duration & export" subtitle="Timing, canvas size and download">
      <div className="duration-list">
        {project.slides.map((slide, i) => {
          const img = slide.coverId ? images.get(slide.coverId) : undefined;
          return (
            <div key={slide.id} className="duration-row">
              <span className="mini-thumb" style={img ? { backgroundImage: `url("${img.url}")` } : undefined}>
                {i + 1}
              </span>
              <span className="duration-label">{stripMarkup(slide.text) || `Slide ${i + 1}`}</span>
              <NumberField
                value={slide.duration}
                min={0.5}
                max={120}
                step={0.5}
                suffix="s"
                onChange={(duration) =>
                  update((p) => ({ ...p, slides: p.slides.map((s, k) => (k === i ? { ...s, duration } : s)) }))
                }
              />
            </div>
          );
        })}
        <div className="duration-row">
          <span className="mini-thumb is-end">END</span>
          <span className="duration-label">
            <Toggle label="End card" checked={e.enabled} onChange={(enabled) => setEnd({ enabled })} />
          </span>
          <NumberField value={e.duration} min={0.5} max={30} step={0.5} suffix="s" onChange={(duration) => setEnd({ duration })} />
        </div>
      </div>

      <div className="total-row">
        <span>
          Total <strong>{formatTime(timeline.total)}</strong>
          {video && <em> · clip {formatTime(clipLength)}</em>}
        </span>
        {video && clipLength > 1 && (
          <button
            type="button"
            className="btn-ghost sm"
            onClick={() => update((p) => fitDurations(p, clipLength))}
            title="Scale all slide durations so the edit is exactly as long as your clip"
          >
            Match clip length
          </button>
        )}
      </div>

      {e.enabled && (
        <div className="endcard">
          <div className="endcard-logo">
            {logo ? (
              <img src={logo.url} alt="End card logo" />
            ) : (
              <span className="logo-empty">No logo</span>
            )}
            <div className="endcard-logo-actions">
              <PickFile accept="image/*" className="btn-ghost sm" onFile={onLogoFile}>
                {logo ? 'Replace logo' : 'Upload logo'}
              </PickFile>
              {logo && (
                <button type="button" className="btn-link" onClick={() => setEnd({ logoId: null })}>
                  Remove
                </button>
              )}
            </div>
          </div>
          {logo && (
            <Slider label="Logo size" value={e.logoSize} min={0.1} max={0.8} step={0.01} format={(x) => `${Math.round(x * 100)}%`} onChange={(logoSize) => setEnd({ logoSize })} />
          )}
          <MarkupEditor ariaLabel="End card text" value={e.text} rows={2} placeholder="Optional text under the logo" onChange={(text) => setEnd({ text })} />
        </div>
      )}

      <div className="grid-2">
        <Slider label="Transition speed" value={m.transition} min={0.2} max={1.5} step={0.05} format={(x) => `${x.toFixed(2)}s`} onChange={(transition) => setMotion({ transition })} />
        <Slider label="Title morph" value={m.morphDuration} min={0.3} max={2.5} step={0.05} format={(x) => `${x.toFixed(2)}s`} onChange={(morphDuration) => setMotion({ morphDuration })} />
      </div>
      <div className="toggles">
        <Toggle label="Fan the crate out at the start" checked={m.fanOut} onChange={(fanOut) => setMotion({ fanOut })} />
      </div>

      <div className="field">
        <div className="field-row">
          <label>Canvas</label>
        </div>
        <Segmented
          size="lg"
          ariaLabel="Export ratio"
          value={project.ratio}
          onChange={(ratio) => update((p) => ({ ...p, ratio }))}
          options={[
            { value: '9:16', label: <RatioIcon w={9} h={16} label="9:16" />, hint: 'Reels · Stories · TikTok' },
            { value: '3:4', label: <RatioIcon w={3} h={4} label="3:4" />, hint: 'Feed post' },
          ]}
        />
      </div>

      <div className="grid-2">
        <label className="select-field">
          <span>Resolution</span>
          <select value={project.export.resolution} onChange={(ev) => setExport({ resolution: Number(ev.target.value) as 1080 | 720 })}>
            <option value={1080}>1080p (recommended)</option>
            <option value={720}>720p (faster)</option>
          </select>
        </label>
        <label className="select-field">
          <span>Frame rate</span>
          <select value={project.export.fps} onChange={(ev) => setExport({ fps: Number(ev.target.value) as 24 | 30 | 60 })}>
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </label>
      </div>
      <label className="select-field">
        <span>Encoder</span>
        <select value={project.export.method} onChange={(ev) => setExport({ method: ev.target.value as 'auto' | 'realtime' })}>
          <option value="auto">Fast (WebCodecs), falls back automatically</option>
          <option value="realtime">Real-time recording</option>
        </select>
      </label>

      <button type="button" className="btn-primary export-btn" onClick={onExport} disabled={exporting}>
        {exporting ? 'Exporting…' : `Export video · ${w}×${h}`}
      </button>
    </Section>
  );
}

function RatioIcon({ w, h, label }: { w: number; h: number; label: string }) {
  const scale = 22 / h;
  return (
    <span className="ratio-icon">
      <span style={{ width: w * scale, height: h * scale }} />
      {label}
    </span>
  );
}
