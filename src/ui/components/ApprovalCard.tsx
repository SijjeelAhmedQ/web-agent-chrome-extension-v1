import { Button, Input } from 'antd';
import { MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ApprovalAnswer, ApprovalPrompt } from '@/agent/runtime/events';

const CANCELS = /^(cancel|close)\b/i;

/** Asks before consequential actions. Focus lands on Cancel — the safe choice. */
export function ApprovalCard({ prompt, onRespond }: { prompt: ApprovalPrompt; onRespond: (answer: ApprovalAnswer) => void }) {
  if (prompt.ask) return <QuestionCard prompt={prompt} onRespond={onRespond} />;
  return <ConfirmCard prompt={prompt} onRespond={onRespond} />;
}

/** The agent's question (ask_user): the task waits for the answer — typed, picked, or said. */
function QuestionCard({ prompt, onRespond }: { prompt: ApprovalPrompt; onRespond: (answer: ApprovalAnswer) => void }) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: false });
  }, [prompt.id]);
  const options = prompt.ask?.options ?? [];
  const send = () => text.trim() && onRespond(text.trim());

  return (
    <section className="approval approval-ask" role="dialog" aria-labelledby={`${prompt.id}-t`}>
      <div className="approval-icon" aria-hidden>
        <MessageCircleQuestion size={18} />
      </div>
      <div className="approval-body">
        <div className="approval-title" id={`${prompt.id}-t`}>
          {prompt.title}
        </div>
        {options.length > 0 && (
          <div className="approval-options" role="group" aria-label="Choices">
            {options.map((o) => (
              <Button key={o} size="small" onClick={() => onRespond(o)}>
                {o}
              </Button>
            ))}
          </div>
        )}
        <div className="approval-answer">
          <Input.TextArea
            ref={(el) => {
              inputRef.current = el?.resizableTextArea?.textArea ?? null;
            }}
            autoSize={{ minRows: 1, maxRows: 5 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={options.length ? 'Or type the answer…' : 'Type your answer…'}
            aria-label="Your answer"
          />
        </div>
        <div className="approval-actions">
          <Button onClick={() => onRespond(false)}>Skip</Button>
          <Button type="primary" onClick={send} disabled={!text.trim()}>
            Send
          </Button>
        </div>
      </div>
    </section>
  );
}

function ConfirmCard({ prompt, onRespond }: { prompt: ApprovalPrompt; onRespond: (answer: ApprovalAnswer) => void }) {
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
