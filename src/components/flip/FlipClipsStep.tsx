import { NEW, type FlipPart, type FlipProject, type FlipTimeline } from '../../engine/flip';
import type { MediaAsset } from '../../engine/reel';
import type { EnhanceStatus } from '../../lib/audioEnhance';
import { AudioEnhanceFields } from '../AudioEnhanceFields';
import { formatTime } from '../../engine/timeline';
import { formatBytes } from '../../lib/media';
import { FileDrop, NumberField, Section, Segmented, Slider } from '../ui';

const FOOTAGE_ACCEPT = 'video/*,image/*,.mov,.mp4,.webm,.m4v,.jpg,.jpeg,.png,.webp,.heic';

interface Props {
  project: FlipProject;
  update: (fn: (p: FlipProject) => FlipProject) => void;
  timeline: FlipTimeline;
  footage: [MediaAsset | null, MediaAsset | null];
  onFootageFile: (part: number, file: File) => void;
  onRemoveFootage: (part: number) => void;
  onSelectPart: (part: number) => void;
  enhanceStatus: [EnhanceStatus, EnhanceStatus];
}

export const partName = (part: number) => (part === NEW ? 'New track' : 'Original');

export function FlipClipsStep({ project, update, timeline, footage, onFootageFile, onRemoveFootage, onSelectPart, enhanceStatus }: Props) {
  const setPart = (part: number, patch: Partial<FlipPart>) =>
    update((p) => {
      const parts = [...p.parts] as FlipProject['parts'];
      parts[part] = { ...parts[part], ...patch };
      return { ...p, parts };
    });
  const setFootage = (patch: Partial<FlipProject['footage']>) => update((p) => ({ ...p, footage: { ...p.footage, ...patch } }));

  return (
    <Section
      step={1}
      title="The two clips"
      subtitle="Footage for the new track and for the original it samples"
      done={!!footage[0] && !!footage[1]}
    >
      <div className="field">
        <div className="field-row">
          <label>Plays first</label>
        </div>
        <Segmented
          ariaLabel="Which clip plays first"
          value={project.first}
          onChange={(first) => update((p) => ({ ...p, first }))}
          options={[
            { value: 'new', label: 'New track first' },
            { value: 'original', label: 'Original first' },
          ]}
        />
      </div>

      {timeline.order.map((part, position) => {
        const asset = footage[part];
        const settings = project.parts[part];
        const usable = asset?.kind === 'video' ? Math.max(0, asset.duration - settings.start) : 0;
        return (
          <div key={part} className="text-section flip-part">
            <div className="text-section-head">
              <button type="button" className="flip-part-title" onClick={() => onSelectPart(part)} title="Show in the preview">
                <span className="step-num">{position + 1}</span>
                <span>
                  {partName(part)}
                  {settings.title.trim() && <small> · {settings.title.trim()}</small>}
                </span>
              </button>
            </div>

            {asset ? (
              <div className="asset-card">
                <div className="asset-icon flip-thumb" aria-hidden style={{ backgroundImage: `url("${asset.thumb}")` }} />
                <div className="asset-meta">
                  <strong title={asset.name}>{asset.name}</strong>
                  <small>
                    {asset.kind === 'video' ? `Video · ${formatTime(asset.duration)}` : 'Photo'} · {asset.width}×{asset.height} ·{' '}
                    {formatBytes(asset.file.size)}
                  </small>
                </div>
                <div className="asset-actions">
                  <FileDrop compact accept={FOOTAGE_ACCEPT} title="Replace" onFiles={(f) => onFootageFile(part, f[0])} />
                  <button type="button" className="btn-ghost" onClick={() => onRemoveFootage(part)}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <FileDrop
                accept={FOOTAGE_ACCEPT}
                title={`Upload the ${part === NEW ? 'new track' : 'original'}'s clip`}
                hint="Video (MP4, MOV, WebM) or a photo · drag & drop or click"
                icon={<span className="big-icon">{part === NEW ? '🎧' : '💿'}</span>}
                onFiles={(f) => onFootageFile(part, f[0])}
              />
            )}

            {asset?.kind === 'video' && (
              <Slider
                label="Start at"
                value={Math.min(settings.start, Math.max(0, asset.duration - 0.5))}
                min={0}
                max={Math.max(0, asset.duration - 0.5)}
                step={0.1}
                format={(x) => `${x.toFixed(1)}s`}
                onChange={(start) => setPart(part, { start })}
              />
            )}
            <div className="flip-part-row">
              <NumberField
                label="On screen"
                value={settings.duration}
                min={1}
                max={90}
                step={0.5}
                suffix="s"
                onChange={(duration) => setPart(part, { duration })}
              />
              {usable > 0 && Math.abs(usable - settings.duration) > 0.05 && (
                <button
                  type="button"
                  className="btn-ghost sm"
                  onClick={() => setPart(part, { duration: Math.max(1, Math.min(90, Math.floor(usable * 10) / 10)) })}
                >
                  Use clip length ({usable.toFixed(1)}s)
                </button>
              )}
            </div>
            {asset?.kind === 'video' && (
              <Slider
                label="Clip sound"
                value={settings.volume}
                min={0}
                max={1}
                step={0.01}
                format={(x) => (x <= 0 ? 'Muted' : `${Math.round(x * 100)}%`)}
                onChange={(volume) => setPart(part, { volume })}
              />
            )}
            {asset?.kind === 'video' && settings.volume > 0 && (
              <AudioEnhanceFields
                value={settings.enhance}
                onChange={(patch) => setPart(part, { enhance: { ...settings.enhance, ...patch } })}
                status={enhanceStatus[part]}
              />
            )}
            {usable > 0 && usable < settings.duration && (
              <p className="note">The clip has {usable.toFixed(1)}s from this point, so it loops.</p>
            )}
          </div>
        );
      })}

      <div className="field">
        <div className="field-row">
          <label>Switch between them</label>
        </div>
        <Segmented
          ariaLabel="Transition"
          value={project.transition}
          onChange={(transition) => update((p) => ({ ...p, transition }))}
          options={[
            { value: 'push', label: 'Push' },
            { value: 'fade', label: 'Fade' },
            { value: 'flash', label: 'Flash' },
            { value: 'cut', label: 'Cut' },
          ]}
        />
      </div>
      <div className="grid-2">
        <Slider
          label="Darken"
          value={project.footage.dim}
          min={0}
          max={0.8}
          step={0.01}
          format={(x) => `${Math.round(x * 100)}%`}
          onChange={(dim) => setFootage({ dim })}
        />
        <Slider
          label="Slow zoom"
          value={project.footage.zoom}
          min={0}
          max={0.25}
          step={0.01}
          format={(x) => (x <= 0 ? 'Off' : `${Math.round(x * 100)}%`)}
          onChange={(zoom) => setFootage({ zoom })}
        />
      </div>
      <p className="note">Each clip plays with its own sound; they crossfade at the switch.</p>
    </Section>
  );
}
