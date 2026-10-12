import { OVERLAY_ACCEPT, type OverlayAsset } from '../../engine/overlay';
import type { ReelOverlay, ReelProject } from '../../engine/reel';
import { formatTime } from '../../engine/timeline';
import { FileDrop, Section, Segmented, Slider, Toggle } from '../ui';

interface Props {
  project: ReelProject;
  update: (fn: (p: ReelProject) => ReelProject) => void;
  overlay: OverlayAsset | null;
  onOverlayFiles: (files: File[]) => void;
  onRemoveOverlay: () => void;
}

function describe(asset: OverlayAsset): string {
  if (asset.kind === 'video') return `Video · ${asset.width}×${asset.height} · ${formatTime(asset.duration)}`;
  if (asset.kind === 'frames') return `${asset.frames.length} frames · ${asset.width}×${asset.height}`;
  return `Still image · ${asset.width}×${asset.height}`;
}

export function OverlayStep({ project, update, overlay, onOverlayFiles, onRemoveOverlay }: Props) {
  const o = project.overlay;
  const set = (patch: Partial<ReelOverlay>) => update((p) => ({ ...p, overlay: { ...p.overlay, ...patch } }));

  return (
    <Section step={2} title="Animation on top" subtitle="Your transparent animation, looping over the shots" done={!!overlay}>
      {overlay ? (
        <div className="asset-card">
          <div className="asset-icon" aria-hidden>
            ✦
          </div>
          <div className="asset-meta">
            <strong title={overlay.name}>{overlay.name}</strong>
            <small>{describe(overlay)}</small>
          </div>
          <div className="asset-actions">
            <FileDrop compact multiple accept={OVERLAY_ACCEPT} title="Replace" onFiles={onOverlayFiles} />
            <button type="button" className="btn-ghost" onClick={onRemoveOverlay}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <>
          <FileDrop
            accept={OVERLAY_ACCEPT}
            multiple
            title="Upload your animation (with transparency)"
            hint="WebM with alpha · PNG sequence (select all frames) · GIF / APNG / WebP · PNG"
            icon={<span className="big-icon">✦</span>}
            onFiles={onOverlayFiles}
          />
          <p className="note">Showing a built-in demo animation until you upload yours.</p>
        </>
      )}

      <div className="toggles">
        <Toggle label="Show animation" checked={o.visible} onChange={(visible) => set({ visible })} />
        <Toggle
          label="Keep it clean"
          hint="Leave the animation out of the colour look, grain and vignette"
          checked={o.abovePost}
          onChange={(abovePost) => set({ abovePost })}
        />
      </div>

      <div className="grid-2">
        <Slider label="Size" value={o.scale} min={0.1} max={1.5} step={0.01} format={(x) => `${Math.round(x * 100)}%`} onChange={(scale) => set({ scale })} />
        <Slider label="Opacity" value={o.opacity} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)}%`} onChange={(opacity) => set({ opacity })} />
        <Slider label="Position ↔" value={o.x} min={-0.1} max={1.1} step={0.005} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => set({ x })} />
        <Slider label="Position ↕" value={o.y} min={-0.1} max={1.1} step={0.005} format={(x) => `${Math.round(x * 100)}%`} onChange={(y) => set({ y })} />
        <Slider label="Speed" value={o.speed} min={0.25} max={3} step={0.05} format={(x) => `${x.toFixed(2)}×`} onChange={(speed) => set({ speed })} />
        {overlay?.kind === 'frames' && !overlay.delays && (
          <Slider label="Frame rate" value={o.fps} min={1} max={60} step={1} format={(x) => `${x} fps`} onChange={(fps) => set({ fps })} />
        )}
      </div>
      <button type="button" className="btn-link" onClick={() => set({ x: 0.5, y: 0.5 })}>
        Centre it
      </button>

      <div className="field">
        <div className="field-row">
          <label>Blend</label>
        </div>
        <Segmented
          ariaLabel="Blend mode"
          value={o.blend}
          onChange={(blend) => set({ blend })}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'screen', label: 'Screen' },
            { value: 'multiply', label: 'Multiply' },
            { value: 'overlay', label: 'Overlay' },
          ]}
        />
      </div>
      <p className="note">Tip: drag the animation around in the preview.</p>
    </Section>
  );
}
