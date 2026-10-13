import { Button } from 'antd';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ApprovalPrompt } from '@/agent/runtime/events';

/** Asks before consequential actions. Focus lands on Cancel — the safe choice. */
export function ApprovalCard({ prompt, onRespond }: { prompt: ApprovalPrompt; onRespond: (approved: boolean) => void }) {
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
        <div className="approval-actions">
          <Button ref={cancelRef} onClick={() => onRespond(false)}>
            Cancel
          </Button>
          <Button type="primary" onClick={() => onRespond(true)}>
            {prompt.confirmLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}
