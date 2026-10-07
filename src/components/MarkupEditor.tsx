import { useEffect, useRef, useState } from 'react';
import { SWATCHES } from './ui';

const TOOLS: { label: string; title: string; marker: string; className?: string; line?: boolean }[] = [
  { label: 'B', title: 'Bold (**text**)', marker: '**', className: 'is-bold' },
  { label: 'I', title: 'Italic (*text*)', marker: '*', className: 'is-italic' },
  { label: 'L', title: 'Light (~text~)', marker: '~', className: 'is-light' },
  { label: 'H', title: 'Headline line (# text)', marker: '# ', line: true },
];

const COLOR_TAG_END = /\{#[0-9a-fA-F]{3,6}\}$/;

/** Textarea with buttons that wrap the selection in CoverVinyl markup. */
export function MarkupEditor(props: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const savedSelection = useRef<[number, number]>([0, 0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lastColor, setLastColor] = useState('#e2402f');
  const latest = useRef(props);
  latest.current = props;

  const select = (start: number, end: number) =>
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(start, end);
    });

  /** The colour span the saved selection sits directly inside, if any. */
  const enclosingSpan = (value: string, s: number, e: number) => {
    const open = COLOR_TAG_END.exec(value.slice(0, s));
    return open && value.startsWith('{/}', e) ? { tagStart: open.index, tagLength: open[0].length } : null;
  };

  /**
   * Wraps the saved selection in {#hex}…{/}, or recolours the span it already
   * sits in. `refocus` is off for the live custom picker so it isn't closed.
   */
  const applyColor = (hex: string, refocus = true) => {
    const { value, onChange } = latest.current;
    const [s, e] = savedSelection.current;
    const tag = `{${hex}}`;
    const span = enclosingSpan(value, s, e);
    const start = span ? span.tagStart + tag.length : s + tag.length;
    const next = span
      ? value.slice(0, span.tagStart) + tag + value.slice(s)
      : value.slice(0, s) + tag + value.slice(s, e) + '{/}' + value.slice(e);
    savedSelection.current = [start, start + (e - s)];
    onChange(next);
    if (refocus) select(start, start + (e - s));
    setLastColor(hex);
  };

  const clearColor = () => {
    const { value, onChange } = latest.current;
    const [s, e] = savedSelection.current;
    const span = enclosingSpan(value, s, e);
    if (!span) return;
    onChange(value.slice(0, span.tagStart) + value.slice(s, e) + value.slice(e + 3));
    select(span.tagStart, span.tagStart + (e - s));
  };

  // Close the colour popover on outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPickerOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const apply = (tool: (typeof TOOLS)[number]) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    let next: string;
    let selStart: number;
    let selEnd: number;
    if (tool.line) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const has = value.startsWith(tool.marker, lineStart);
      next = has
        ? value.slice(0, lineStart) + value.slice(lineStart + tool.marker.length)
        : value.slice(0, lineStart) + tool.marker + value.slice(lineStart);
      const delta = has ? -tool.marker.length : tool.marker.length;
      selStart = Math.max(lineStart, s + delta);
      selEnd = Math.max(lineStart, e + delta);
    } else {
      const m = tool.marker;
      const selected = value.slice(s, e);
      const wrapped = value.slice(s - m.length, s) === m && value.slice(e, e + m.length) === m;
      if (wrapped) {
        next = value.slice(0, s - m.length) + selected + value.slice(e + m.length);
        selStart = s - m.length;
        selEnd = e - m.length;
      } else {
        next = value.slice(0, s) + m + selected + m + value.slice(e);
        selStart = s + m.length;
        selEnd = e + m.length;
      }
    }
    props.onChange(next);
    select(selStart, selEnd);
  };

  return (
    <div className="markup-editor">
      <div className="markup-tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            type="button"
            className={tool.className}
            title={tool.title}
            aria-label={tool.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(tool)}
          >
            {tool.label}
          </button>
        ))}
        <div className="color-tool-wrap" ref={pickerRef}>
          <button
            type="button"
            className="color-tool"
            title="Colour the selected text"
            aria-label="Colour the selected text"
            aria-expanded={pickerOpen}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const el = ref.current;
              // A textarea keeps its selection while unfocused, so this works from the keyboard too.
              if (el) savedSelection.current = [el.selectionStart, el.selectionEnd];
              setPickerOpen((o) => !o);
            }}
          >
            A<i style={{ background: lastColor }} />
          </button>
          {pickerOpen && (
            <div className="color-pop" role="dialog" aria-label="Text colour" onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}>
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="swatch"
                  style={{ background: c }}
                  aria-label={`Colour ${c}`}
                  onClick={() => {
                    applyColor(c);
                    setPickerOpen(false);
                  }}
                />
              ))}
              <label className="swatch is-custom" title="Custom colour">
                <input type="color" defaultValue={lastColor} onChange={(e) => applyColor(e.target.value, false)} aria-label="Custom colour" />
                <span>+</span>
              </label>
              <button
                type="button"
                className="color-pop-clear"
                onClick={() => {
                  clearColor();
                  setPickerOpen(false);
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>
      <textarea
        ref={ref}
        value={props.value}
        rows={props.rows ?? 5}
        placeholder={props.placeholder}
        spellCheck={false}
        aria-label={props.ariaLabel}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}
