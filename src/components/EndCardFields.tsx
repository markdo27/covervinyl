import type { EndCard, ImageAsset } from '../engine/types';
import { MarkupEditor } from './MarkupEditor';
import { ColorField, PickFile, Slider } from './ui';

/** Logo (upload, recolour, size) and text for an end card — shared by the editors. */
export function EndCardFields(props: {
  endCard: EndCard;
  logo: ImageAsset | undefined;
  onChange: (patch: Partial<EndCard>) => void;
  onLogoFile: (file: File) => void;
  textPlaceholder?: string;
}) {
  const { endCard: e, logo, onChange } = props;
  return (
    <div className="endcard">
      <div className="endcard-logo">
        {logo && e.logoColor ? (
          <span
            className="logo-tinted"
            role="img"
            aria-label="End card logo"
            style={{
              backgroundColor: e.logoColor,
              maskImage: `url("${logo.url}")`,
              WebkitMaskImage: `url("${logo.url}")`,
            }}
          />
        ) : logo ? (
          <img src={logo.url} alt="End card logo" />
        ) : (
          <span className="logo-empty">No logo</span>
        )}
        <div className="endcard-logo-actions">
          <PickFile accept="image/*" className="btn-ghost sm" onFile={props.onLogoFile}>
            {logo ? 'Replace logo' : 'Upload logo'}
          </PickFile>
          {logo && (
            <button type="button" className="btn-link" onClick={() => onChange({ logoId: null })}>
              Remove
            </button>
          )}
        </div>
      </div>
      {logo && (
        <ColorField
          label="Logo colour"
          value={e.logoColor}
          fallback="#ffffff"
          defaultLabel="Original"
          onChange={(logoColor) => onChange({ logoColor })}
        />
      )}
      {logo && e.logoColor && (
        <p className="note">Recolouring fills every visible pixel — use a logo with a transparent background (PNG or SVG).</p>
      )}
      {logo && (
        <Slider
          label="Logo size"
          value={e.logoSize}
          min={0.1}
          max={0.8}
          step={0.01}
          format={(x) => `${Math.round(x * 100)}%`}
          onChange={(logoSize) => onChange({ logoSize })}
        />
      )}
      <MarkupEditor
        ariaLabel="End card text"
        value={e.text}
        rows={2}
        placeholder={props.textPlaceholder ?? 'Optional text under the logo'}
        onChange={(text) => onChange({ text })}
      />
    </div>
  );
}
