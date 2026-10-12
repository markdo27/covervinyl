import { OUTPUT_SIZES } from '../../engine/defaults';
import type { ReelProject, ReelTimeline } from '../../engine/reel';
import { formatTime } from '../../engine/timeline';
import { Section, Segmented } from '../ui';

interface Props {
  project: ReelProject;
  update: (fn: (p: ReelProject) => ReelProject) => void;
  timeline: ReelTimeline;
  onExport: () => void;
  exporting: boolean;
}

export function ReelExportStep({ project, update, timeline, onExport, exporting }: Props) {
  const setExport = (patch: Partial<ReelProject['export']>) => update((p) => ({ ...p, export: { ...p.export, ...patch } }));
  const [w, h] = OUTPUT_SIZES[project.ratio][project.export.resolution];

  return (
    <Section step={5} title="Export" subtitle="Canvas, quality and download">
      <div className="total-row">
        <span>
          Reel length <strong>{formatTime(timeline.total)}</strong>
        </span>
        {timeline.total > 90 && <em>Reels can be up to 90s in most places</em>}
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
            { value: '9:16', label: '9:16', hint: 'Reels · Stories · TikTok' },
            { value: '3:4', label: '3:4', hint: 'Feed post' },
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
        {exporting ? 'Exporting…' : `Export reel · ${w}×${h}`}
      </button>
    </Section>
  );
}
