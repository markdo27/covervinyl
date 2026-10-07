import { useRef } from 'react';

const TOOLS: { label: string; title: string; marker: string; className?: string; line?: boolean }[] = [
  { label: 'B', title: 'Bold (**text**)', marker: '**', className: 'is-bold' },
  { label: 'I', title: 'Italic (*text*)', marker: '*', className: 'is-italic' },
  { label: 'L', title: 'Light (~text~)', marker: '~', className: 'is-light' },
  { label: 'H', title: 'Headline line (# text)', marker: '# ', line: true },
];

/** Textarea with buttons that wrap the selection in CoverVinyl markup. */
export function MarkupEditor(props: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

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
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
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
