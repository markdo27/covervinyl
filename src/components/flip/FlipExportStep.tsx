import { OUTPUT_SIZES } from '../../engine/defaults';
import type { FlipProject, FlipTimeline } from '../../engine/flip';
import { formatTime } from '../../engine/timeline';
import { MarkupEditor } from '../MarkupEditor';
import { Section, Segmented, Slider, Toggle } from '../ui';

interface Props {
  project: FlipProject;
  update: (fn: (p: FlipProject) => FlipProject) => void;
  timeline: FlipTimeline;
  onExport: () => void;
  exporting: boolean;
}

export function FlipExportStep({ project, update, timeline, onExport, exporting }: Props) {
  const setExport = (patch: Partial<FlipProject['export']>) => update((p) => ({ ...p, export: { ...p.export, ...patch } }));
  const setOutro = (patch: Partial<FlipProject['outro']>) => update((p) => ({ ...p, outro: { ...p.outro, ...patch } }));
  const [w, h] = OUTPUT_SIZES[project.ratio][project.export.resolution];

  return (
    <Section step={6} title="Closing card & export" subtitle="Both covers side by side, canvas and download">
      <div className="text-section">
        <Toggle
          label="Closing card"
          hint="The original and the new track side by side: sample → flip"
          checked={project.outro.enabled}
          onChange={(enabled) => setOutro({ enabled })}
        />
        {project.outro.enabled && (
          <>
            <Slider
              label="Shown for"
              value={project.outro.duration}
              min={1}
              max={8}
              step={0.1}
              format={(x) => `${x.toFixed(1)}s`}
              onChange={(duration) => setOutro({ duration })}
            />
            <MarkupEditor
              value={project.outro.text}
              onChange={(text) => setOutro({ text })}
              rows={2}
              placeholder="**your name** archives"
              ariaLabel="Closing card text"
            />
          </>
        )}
      </div>

      <div className="total-row">
        <span>
          Video length <strong>{formatTime(timeline.total)}</strong>
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
        {exporting ? 'Exporting…' : `Export video · ${w}×${h}`}
      </button>
    </Section>
  );
}
