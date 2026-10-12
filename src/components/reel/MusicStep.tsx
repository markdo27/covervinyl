import { beatDuration, setAllDurations, type ReelProject } from '../../engine/reel';
import type { MusicAsset } from '../../engine/reelMedia';
import { formatTime } from '../../engine/timeline';
import { FileDrop, NumberField, Section, Segmented, Slider } from '../ui';

interface Props {
  project: ReelProject;
  update: (fn: (p: ReelProject) => ReelProject) => void;
  music: MusicAsset | null;
  onMusicFile: (file: File) => void;
  onRemoveMusic: () => void;
}

export function MusicStep({ project, update, music, onMusicFile, onRemoveMusic }: Props) {
  const m = project.music;
  const set = (patch: Partial<ReelProject['music']>) => update((p) => ({ ...p, music: { ...p.music, ...patch } }));
  const beat = beatDuration(project.bpm, project.beatsPerCut);

  return (
    <Section step={3} title="Soundtrack & beat" subtitle="Optional music, and cuts timed to the beat" done={!!music}>
      {music ? (
        <div className="asset-card">
          <div className="asset-icon" aria-hidden>
            ♪
          </div>
          <div className="asset-meta">
            <strong title={music.name}>{music.name}</strong>
            <small>{formatTime(music.duration)}</small>
          </div>
          <div className="asset-actions">
            <FileDrop compact accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg" title="Replace" onFiles={(f) => onMusicFile(f[0])} />
            <button type="button" className="btn-ghost" onClick={onRemoveMusic}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <FileDrop
          accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg"
          title="Upload a soundtrack (optional)"
          hint="MP3, M4A, WAV · or add music in Instagram later"
          icon={<span className="big-icon">♪</span>}
          onFiles={(f) => onMusicFile(f[0])}
        />
      )}

      {music && (
        <div className="grid-2">
          <Slider
            label="Start at"
            value={Math.min(m.start, Math.max(0, music.duration - 1))}
            min={0}
            max={Math.max(0, music.duration - 1)}
            step={0.1}
            format={(x) => `${x.toFixed(1)}s`}
            onChange={(start) => set({ start })}
          />
          <Slider label="Volume" value={m.volume} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)}%`} onChange={(volume) => set({ volume })} />
        </div>
      )}

      <div className="field">
        <div className="field-row">
          <label>Cut on the beat</label>
          <span className="field-value">{beat.toFixed(3)}s per shot</span>
        </div>
        <div className="beat-row">
          <NumberField label="BPM" value={project.bpm} min={40} max={240} step={1} onChange={(bpm) => update((p) => ({ ...p, bpm }))} />
          <Segmented
            ariaLabel="Beats per shot"
            value={String(project.beatsPerCut)}
            onChange={(v) => update((p) => ({ ...p, beatsPerCut: Number(v) }))}
            options={[
              { value: '0.5', label: '½' },
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '4', label: '4' },
            ]}
          />
          <button type="button" className="btn-ghost sm" onClick={() => update((p) => setAllDurations(p, beat))}>
            Apply to all shots
          </button>
        </div>
        <small className="note">Beats per shot: ½ = double-time cuts, 4 = one cut per bar.</small>
      </div>
    </Section>
  );
}
