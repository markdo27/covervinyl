import { useState } from 'react';
import { formatTime } from '../../engine/timeline';
import { setAllDurations, type MediaAsset, type ReelProject, type ReelTimeline } from '../../engine/reel';
import { FileDrop, NumberField, PickFile, Section, Segmented, Slider } from '../ui';

interface Props {
  project: ReelProject;
  update: (fn: (p: ReelProject) => ReelProject) => void;
  timeline: ReelTimeline;
  getMedia: (id: string | null) => MediaAsset | null;
  activeShot: number;
  onAddMedia: (files: File[]) => void;
  onReplaceMedia: (index: number, file: File) => void;
  onSelectShot: (index: number) => void;
}

export function MediaStep({ project, update, timeline, getMedia, activeShot, onAddMedia, onReplaceMedia, onSelectShot }: Props) {
  const uploaded = project.items.filter((it) => getMedia(it.assetId)).length;
  const [allLength, setAllLength] = useState(project.items[0]?.duration ?? 0.5);

  const setItem = (i: number, patch: Partial<ReelProject['items'][number]>) =>
    update((p) => ({ ...p, items: p.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }));
  const move = (i: number, dir: -1 | 1) =>
    update((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.items.length) return p;
      const items = [...p.items];
      [items[i], items[j]] = [items[j], items[i]];
      return { ...p, items };
    });
  const remove = (i: number) => update((p) => (p.items.length <= 1 ? p : { ...p, items: p.items.filter((_, k) => k !== i) }));
  const shuffle = () =>
    update((p) => {
      const items = [...p.items];
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return { ...p, items };
    });

  return (
    <Section step={1} title="Photos & clips" subtitle="Your shots, cut one after another" done={uploaded > 0}>
      <FileDrop
        accept="image/*,video/*,.mov,.mp4,.webm,.m4v"
        multiple
        title="Upload your photos & videos"
        hint="Select many at once · JPG, PNG, WebP, MP4, MOV · they play in name order"
        icon={<span className="big-icon">📷</span>}
        onFiles={onAddMedia}
      />

      <ol className="cover-grid shot-grid">
        {project.items.map((item, i) => {
          const asset = getMedia(item.assetId);
          return (
            <li key={item.id} className={`cover-card ${i === activeShot ? 'is-active' : ''}`}>
              <button
                type="button"
                className="cover-thumb shot-thumb"
                onClick={() => onSelectShot(i)}
                title={asset ? `${asset.name} — jump here` : `Shot ${i + 1}`}
                style={asset?.thumb ? { backgroundImage: `url("${asset.thumb}")` } : undefined}
              >
                {!asset && <span className="cover-empty">Empty</span>}
                <span className="cover-num">{i + 1}</span>
                {asset?.kind === 'video' && <span className="shot-badge">▶ {formatTime(asset.duration, false)}</span>}
              </button>
              <NumberField
                value={item.duration}
                min={0.1}
                max={30}
                step={0.05}
                suffix="s"
                onChange={(duration) => setItem(i, { duration })}
              />
              {asset?.kind === 'video' && (
                <NumberField
                  label="from"
                  value={item.start}
                  min={0}
                  max={Math.max(0, asset.duration - 0.1)}
                  step={0.1}
                  suffix="s"
                  onChange={(start) => setItem(i, { start })}
                />
              )}
              <div className="cover-actions">
                <PickFile accept="image/*,video/*" className="icon-btn" title="Replace" onFile={(f) => onReplaceMedia(i, f)}>
                  ⤒
                </PickFile>
                <button type="button" className="icon-btn" title="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                  ←
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Move later"
                  disabled={i === project.items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  →
                </button>
                <button
                  type="button"
                  className="icon-btn is-danger"
                  title="Remove shot"
                  disabled={project.items.length <= 1}
                  onClick={() => remove(i)}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="total-row">
        <span>
          {project.items.length} shots · <strong>{formatTime(timeline.total)}</strong>
        </span>
        <button type="button" className="btn-ghost sm" onClick={shuffle} disabled={project.items.length < 2}>
          Shuffle
        </button>
      </div>

      <div className="inline-apply">
        <NumberField label="Every shot" value={allLength} min={0.1} max={30} step={0.05} suffix="s" onChange={setAllLength} />
        <button type="button" className="btn-ghost sm" onClick={() => update((p) => setAllDurations(p, allLength))}>
          Apply to all
        </button>
      </div>

      <div className="field">
        <div className="field-row">
          <label>Between shots</label>
        </div>
        <Segmented
          ariaLabel="Transition"
          value={project.transition}
          onChange={(transition) => update((p) => ({ ...p, transition }))}
          options={[
            { value: 'cut', label: 'Cut' },
            { value: 'fade', label: 'Fade' },
            { value: 'flash', label: 'Flash' },
          ]}
        />
      </div>
      <Slider
        label="Slow zoom"
        value={project.zoom}
        min={0}
        max={0.25}
        step={0.01}
        format={(x) => (x === 0 ? 'off' : `+${Math.round(x * 100)}%`)}
        onChange={(zoom) => update((p) => ({ ...p, zoom }))}
      />
      <p className="note">Clip sound is muted — add a soundtrack in step 3.</p>
    </Section>
  );
}
