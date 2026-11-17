import { useState } from 'react';
import { formatNumber, parseDecimal } from './logic';

interface Props {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  onStep: (dir: 1 | -1) => void;
  inputMode: 'decimal' | 'numeric';
  label: string;
  /** Largura do campo central, em px. */
  width: number;
}

/** Campo numérico com − / +: tocar no número abre o teclado (aceita vírgula). */
export function NumberField({ value, onCommit, onStep, inputMode, label, width }: Props) {
  const [text, setText] = useState<string | null>(null);

  function commit() {
    if (text === null) return;
    const parsed = parseDecimal(text);
    if (text.trim() === '') onCommit(undefined);
    else if (parsed !== undefined && parsed !== value) onCommit(parsed);
    setText(null);
  }

  return (
    <div className="ss-stepper">
      <button type="button" className="ss-step" aria-label={`Diminuir ${label}`} onClick={() => onStep(-1)}>
        −
      </button>
      <input
        className="ss-num"
        style={{ width }}
        type="text"
        inputMode={inputMode}
        enterKeyHint="done"
        aria-label={label}
        placeholder="—"
        value={text ?? formatNumber(value)}
        onFocus={(e) => {
          setText(formatNumber(value));
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button type="button" className="ss-step" aria-label={`Aumentar ${label}`} onClick={() => onStep(1)}>
        +
      </button>
    </div>
  );
}
