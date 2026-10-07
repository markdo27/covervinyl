import { useId, useRef, useState, type ReactNode } from 'react';

export function Section(props: {
  step: number;
  title: string;
  subtitle?: string;
  done?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <section className={`step ${open ? 'is-open' : ''}`}>
      <button type="button" className="step-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`step-num ${props.done ? 'is-done' : ''}`}>{props.done ? '✓' : props.step}</span>
        <span className="step-titles">
          <span className="step-title">{props.title}</span>
          {props.subtitle && <span className="step-sub">{props.subtitle}</span>}
        </span>
        <span className="step-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && <div className="step-body">{props.children}</div>}
    </section>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="field slider">
      <div className="field-row">
        <label htmlFor={id}>{props.label}</label>
        <span className="field-value">{props.format ? props.format(props.value) : props.value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 0.01}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
    </label>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ReactNode; hint?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'lg';
  ariaLabel?: string;
}) {
  return (
    <div className={`segmented ${props.size === 'lg' ? 'is-lg' : ''}`} role="radiogroup" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? 'is-active' : ''}
          onClick={() => props.onChange(o.value)}
        >
          <span>{o.label}</span>
          {o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}

export function NumberField(props: {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const v = Number(raw.replace(',', '.'));
    if (Number.isFinite(v)) {
      const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v));
      props.onChange(clamped);
    }
    setDraft(null);
  };
  return (
    <label className="number-field">
      {props.label && <span>{props.label}</span>}
      <span className="number-wrap">
        <input
          type="number"
          inputMode="decimal"
          value={draft ?? String(props.value)}
          min={props.min}
          max={props.max}
          step={props.step ?? 0.1}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(v) && v >= (props.min ?? -Infinity) && v <= (props.max ?? Infinity)) {
              props.onChange(v);
            }
          }}
          onBlur={(e) => commit(e.target.value)}
        />
        {props.suffix && <em>{props.suffix}</em>}
      </span>
    </label>
  );
}

export function FileDrop(props: {
  accept: string;
  multiple?: boolean;
  title: string;
  hint?: string;
  icon?: ReactNode;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? 'is-over' : ''} ${props.compact ? 'is-compact' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) props.onFiles(props.multiple ? files : files.slice(0, 1));
      }}
    >
      {props.icon && <span className="dropzone-icon">{props.icon}</span>}
      <span className="dropzone-text">
        <strong>{props.title}</strong>
        {props.hint && <small>{props.hint}</small>}
      </span>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={props.accept}
        multiple={props.multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) props.onFiles(files);
        }}
      />
    </div>
  );
}

export function PickFile(props: {
  accept: string;
  className?: string;
  children: ReactNode;
  title?: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={props.className} title={props.title} onClick={() => inputRef.current?.click()}>
        {props.children}
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={props.accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) props.onFile(file);
        }}
      />
    </>
  );
}
