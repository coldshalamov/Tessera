import { useState } from 'react';
import { copyText } from '../lib/download.js';

/**
 * Abbreviated key/hash rendered as a button: title shows the full value,
 * click copies it. The full value stays one interaction away without
 * widening the layout (docs/08: "hover/copy reveals full key").
 */
export function Copyable(props: { value: string; display: string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'unavailable'>('idle');
  return (
    <button
      type="button"
      className="copyable mono"
      title={`${props.value} — activate to copy`}
      onClick={() => {
        void copyText(props.value).then((okc) => {
          setState(okc ? 'copied' : 'unavailable');
          setTimeout(() => setState('idle'), 1500);
        });
      }}
    >
      {props.display}
      <span className="copy-state" aria-live="polite">
        {state === 'copied' ? ' copied' : state === 'unavailable' ? ' (copy unsupported)' : ''}
      </span>
    </button>
  );
}
