import { Button } from 'antd';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ApprovalAnswer, ApprovalPrompt } from '@/agent/runtime/events';

const CANCELS = /^(cancel|close)$/i;

/** Asks before consequential actions. Focus lands on Cancel — the safe choice. */
export function ApprovalCard({ prompt, onRespond }: { prompt: ApprovalPrompt; onRespond: (answer: ApprovalAnswer) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: false });
  }, [prompt.id]);

  return (
    <section className="approval" role="alertdialog" aria-labelledby={`${prompt.id}-t`} aria-describedby={`${prompt.id}-d`}>
      <div className="approval-icon" aria-hidden>
        <ShieldAlert size={18} />
      </div>
      <div className="approval-body">
        <div className="approval-title" id={`${prompt.id}-t`}>
          {prompt.title}
        </div>
        <div className="approval-detail" id={`${prompt.id}-d`}>
          {prompt.detail}
        </div>
        {prompt.fields && prompt.fields.length > 0 && (
          <dl className="approval-fields" aria-label="What will be saved">
            {prompt.fields.map((f) => (
              <div key={f.label} className="approval-field">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {prompt.choices?.length ? (
          // The form's own buttons, as on the page: the user picks one. Its Cancel cancels here and there.
          <div className="approval-actions approval-choices">
            {prompt.choices.map((c) => {
              const cancels = CANCELS.test(c.label);
              return (
                <Button
                  key={c.id}
                  ref={cancels ? cancelRef : undefined}
                  type={c.id === prompt.target ? 'primary' : 'default'}
                  danger={cancels}
                  onClick={() => onRespond(cancels ? false : c.id === prompt.target ? true : c.id)}
                >
                  {c.label}
                </Button>
              );
            })}
            {!prompt.choices.some((c) => CANCELS.test(c.label)) && (
              <Button ref={cancelRef} onClick={() => onRespond(false)}>
                Not now
              </Button>
            )}
          </div>
        ) : (
          <div className="approval-actions">
            <Button ref={cancelRef} onClick={() => onRespond(false)}>
              Cancel
            </Button>
            <Button type="primary" onClick={() => onRespond(true)}>
              {prompt.confirmLabel}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
