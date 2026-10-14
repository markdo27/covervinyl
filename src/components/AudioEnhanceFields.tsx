import { formatDb, type AudioEnhance } from '../engine/audioEnhance';
import type { EnhanceStatus } from '../lib/audioEnhance';
import { Slider, Toggle } from './ui';

const pct = (x: number) => (x <= 0 ? 'Off' : `${Math.round(x * 100)}%`);

function statusText(status: EnhanceStatus): string {
  switch (status.state) {
    case 'working':
      return `Cleaning up the sound… ${Math.round(status.progress * 100)}%`;
    case 'ready': {
      const { noiseDb, inputLufs, outputLufs } = status.stats;
      const parts = [];
      if (noiseDb < -0.5) parts.push(`background noise ${formatDb(noiseDb)}`);
      if (Number.isFinite(inputLufs) && Number.isFinite(outputLufs)) {
        const lufs = (v: number) => `${v < -0.5 ? '−' : ''}${Math.abs(Math.round(v))}`;
        parts.push(`loudness ${lufs(inputLufs)} → ${lufs(outputLufs)} LUFS`);
      }
      return parts.length ? `Done: ${parts.join(' · ')}. Toggle “Enhance audio” while playing to compare.` : 'Done.';
    }
    case 'no-audio':
      return 'This clip has no sound to enhance.';
    case 'error':
      return `Couldn't clean up the sound: ${status.message}`;
    default:
      return '';
  }
}

/** Audio clean-up controls for a clip recorded on a phone. */
export function AudioEnhanceFields(props: {
  value: AudioEnhance;
  onChange: (patch: Partial<AudioEnhance>) => void;
  status: EnhanceStatus;
}) {
  const v = props.value;
  const text = statusText(props.status);
  return (
    <div className="enhance">
      <Toggle
        label="Enhance audio"
        hint="For phone-mic recordings: less background noise and rumble, clearer music, Instagram loudness"
        checked={v.enabled}
        onChange={(enabled) => props.onChange({ enabled })}
      />
      {v.enabled && (
        <>
          <div className="grid-2">
            <Slider label="Noise reduction" value={v.denoise} min={0} max={1} step={0.05} format={pct} onChange={(denoise) => props.onChange({ denoise })} />
            <Slider label="Music clarity" value={v.clarity} min={0} max={1} step={0.05} format={pct} onChange={(clarity) => props.onChange({ clarity })} />
          </div>
          <div className="toggles inline">
            <Toggle label="Cut rumble" checked={v.rumble} onChange={(rumble) => props.onChange({ rumble })} />
            <Toggle label="Instagram loudness" hint="−14 LUFS" checked={v.normalize} onChange={(normalize) => props.onChange({ normalize })} />
          </div>
          {text && (
            <p className={`note enhance-status ${props.status.state === 'error' ? 'is-error' : ''}`} role="status">
              {props.status.state === 'working' && (
                <span className="enhance-bar" aria-hidden>
                  <span style={{ width: `${Math.round(props.status.progress * 100)}%` }} />
                </span>
              )}
              {text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
