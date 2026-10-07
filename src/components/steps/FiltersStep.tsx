import { useMemo } from 'react';
import { applyLutCpu, LOOKS, presetLut, type Lut } from '../../engine/luts';
import { postSupported } from '../../engine/post';
import type { Project } from '../../engine/types';
import { PickFile, Section, Slider } from '../ui';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  customLuts: Lut[];
  onLutFile: (file: File) => void;
  onRemoveLut: (key: string) => void;
}

const THUMB_W = 96;
const THUMB_H = 60;
let sample: ImageData | null = null;
const thumbCache = new Map<string, string>();

/** A tiny "scene" (sky, skin, foliage, grey ramp) that shows a look's character. */
function sampleImage(): ImageData {
  if (sample) return sample;
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const sky = ctx.createLinearGradient(0, 0, 0, THUMB_H * 0.6);
  sky.addColorStop(0, '#3d7fc4');
  sky.addColorStop(1, '#bcd9ee');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  ctx.fillStyle = '#3f6b2c';
  ctx.fillRect(0, THUMB_H * 0.55, THUMB_W, THUMB_H * 0.3);
  const skin = ctx.createRadialGradient(THUMB_W * 0.64, THUMB_H * 0.42, 2, THUMB_W * 0.64, THUMB_H * 0.42, THUMB_H * 0.3);
  skin.addColorStop(0, '#f0c3a0');
  skin.addColorStop(1, '#9a5c3c');
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(THUMB_W * 0.64, THUMB_H * 0.42, THUMB_H * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(THUMB_W * 0.08, THUMB_H * 0.3, THUMB_W * 0.2, THUMB_H * 0.4);
  const ramp = ctx.createLinearGradient(0, 0, THUMB_W, 0);
  ramp.addColorStop(0, '#000');
  ramp.addColorStop(1, '#fff');
  ctx.fillStyle = ramp;
  ctx.fillRect(0, THUMB_H * 0.85, THUMB_W, THUMB_H * 0.15);
  sample = ctx.getImageData(0, 0, THUMB_W, THUMB_H);
  return sample;
}

function thumbnail(lut: Lut | null): string {
  const key = lut ? `${lut.key}:${lut.size}` : 'none';
  const cached = thumbCache.get(key);
  if (cached) return cached;
  const src = sampleImage();
  const pixels = new Uint8ClampedArray(src.data);
  if (lut) applyLutCpu(pixels, lut);
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  c.getContext('2d')!.putImageData(new ImageData(pixels, THUMB_W, THUMB_H), 0, 0);
  const url = c.toDataURL();
  thumbCache.set(key, url);
  return url;
}

export function FiltersStep({ project, update, customLuts, onLutFile, onRemoveLut }: Props) {
  const post = project.post;
  const set = (patch: Partial<Project['post']>) => update((p) => ({ ...p, post: { ...p.post, ...patch } }));
  const supported = useMemo(postSupported, []);
  const looks = useMemo(
    () => [
      { key: 'none', name: 'Original', lut: null as Lut | null, custom: false },
      ...LOOKS.map((l) => ({ key: l.key, name: l.name, lut: presetLut(l.key), custom: false })),
      ...customLuts.map((l) => ({ key: l.key, name: l.name, lut: l, custom: true })),
    ],
    [customLuts],
  );
  const active = post.lut !== 'none' || post.grain > 0 || post.vignette > 0;

  return (
    <Section step={5} title="Look & grain" subtitle="Cinematic colour, film grain and vignette" done={active}>
      {!supported && (
        <p className="note warn">This browser has no WebGL2, so filters can't be previewed or exported here.</p>
      )}

      <div className="field">
        <div className="field-row">
          <label>Colour look (LUT)</label>
          <PickFile accept=".cube,text/plain" className="btn-link" onFile={onLutFile} title="Load a .cube LUT file">
            + Upload .cube
          </PickFile>
        </div>
        <div className="look-grid" role="radiogroup" aria-label="Colour look">
          {looks.map((look) => (
            <div key={look.key} className="look-wrap">
              <button
                type="button"
                role="radio"
                aria-checked={post.lut === look.key}
                className={`look ${post.lut === look.key ? 'is-active' : ''}`}
                onClick={() => set({ lut: look.key })}
                title={look.name}
              >
                <img src={thumbnail(look.lut)} alt="" width={THUMB_W} height={THUMB_H} />
                <span>{look.name}</span>
              </button>
              {look.custom && (
                <button
                  type="button"
                  className="look-remove"
                  title={`Remove ${look.name}`}
                  aria-label={`Remove ${look.name}`}
                  onClick={() => onRemoveLut(look.key)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {post.lut !== 'none' && (
        <Slider
          label="Look intensity"
          value={post.lutIntensity}
          min={0}
          max={1}
          step={0.01}
          format={(x) => `${Math.round(x * 100)}%`}
          onChange={(lutIntensity) => set({ lutIntensity })}
        />
      )}

      <div className="grid-2">
        <Slider label="Film grain" value={post.grain} min={0} max={1} step={0.01} format={(x) => (x === 0 ? 'off' : `${Math.round(x * 100)}%`)} onChange={(grain) => set({ grain })} />
        <Slider label="Grain size" value={post.grainSize} min={1} max={4} step={0.1} format={(x) => `${x.toFixed(1)}px`} onChange={(grainSize) => set({ grainSize })} />
        <Slider label="Vignette" value={post.vignette} min={0} max={1} step={0.01} format={(x) => (x === 0 ? 'off' : `${Math.round(x * 100)}%`)} onChange={(vignette) => set({ vignette })} />
      </div>
      {active && (
        <button
          type="button"
          className="btn-link"
          onClick={() => set({ lut: 'none', lutIntensity: 1, grain: 0, vignette: 0 })}
        >
          Reset filters
        </button>
      )}
    </Section>
  );
}
