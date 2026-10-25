import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { formatWithCommas } from '../../lib/format';

interface Props {
  value: number;
  onCommit: (v: number) => void;
  scale?: number;
  digits?: number;
  /** Clamp bounds in stored units (a 0-100% field with scale 100 takes max={1}). */
  min?: number;
  max?: number;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  /** Commit only on blur (clamped to min/max), not on every keystroke. For fields whose partial values
   *  are invalid, such as a year (2, 20, 203 …). */
  commitOnBlur?: boolean;
  /** Pairs with a `<label htmlFor>`. */
  id?: string;
  /** Accessible name when there is no visible label (table rows). */
  ariaLabel?: string;
}

const formatFor = (v: number, scale: number, digits?: number, withCommas = false): string => {
  if (!isFinite(v)) return '';
  const display = v * scale;
  const text = digits != null ? display.toFixed(digits) : String(display);
  return withCommas ? formatWithCommas(text) : text;
};

const stripCommas = (s: string) => s.replace(/,/g, '');

export function NumberInput({
  value,
  onCommit,
  scale = 1,
  digits,
  min,
  max,
  className,
  style,
  placeholder,
  disabled,
  commitOnBlur = false,
  id,
  ariaLabel,
}: Props) {
  // Live comma formatting is only useful for unscaled, integer-ish dollar inputs.
  // Percentage / decimal inputs (scale != 1 or digits set) skip it so the user
  // can type "0.5" without seeing it morph mid-keystroke.
  const useCommas = scale === 1 && digits == null;
  const [draft, setDraft] = useState<string>(() => formatFor(value, scale, digits, useCommas));
  const focusedRef = useRef(false);
  // Set by typing. A blur without an edit commits nothing, so tabbing through a field never rewrites the
  // stored value with its rounded display (0.0625 shown as 6.3 would be saved as 0.063).
  const editedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatFor(value, scale, digits, useCommas));
  }, [value, scale, digits, useCommas]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const stripped = useCommas ? stripCommas(raw) : raw;
    if (digits != null) {
      const dotIdx = stripped.indexOf('.');
      if (dotIdx !== -1 && stripped.length - dotIdx - 1 > digits) return;
    }
    setDraft(useCommas ? formatWithCommas(stripped) : raw);
    editedRef.current = true;
    if (commitOnBlur) return;
    if (stripped === '' || stripped === '-' || stripped === '.' || stripped === '-.') return;
    const parsed = parseFloat(stripped);
    if (isNaN(parsed)) return;
    onCommit(parsed / scale);
  };

  const handleBlur = () => {
    focusedRef.current = false;
    const edited = editedRef.current;
    editedRef.current = false;
    const stripped = useCommas ? stripCommas(draft) : draft;
    const parsed = parseFloat(stripped);
    if (!edited || isNaN(parsed)) {
      setDraft(formatFor(value, scale, digits, useCommas));
      return;
    }
    let committed = parsed / scale;
    if (min != null) committed = Math.max(min, committed);
    if (max != null) committed = Math.min(max, committed);
    onCommit(committed);
    setDraft(formatFor(committed, scale, digits, useCommas));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      id={id}
      aria-label={ariaLabel}
      className={className}
      style={style}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => { focusedRef.current = true; }}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
