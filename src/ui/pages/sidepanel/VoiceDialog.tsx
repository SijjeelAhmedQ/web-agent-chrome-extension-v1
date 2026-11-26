import { Loader2, Mic, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { VoiceDialogState } from '../../hooks/useVoiceDialog';

interface Props {
  state: VoiceDialogState;
  final: string;
  interim: string;
  level: number;
  error: string | null;
  /** What is being asked, when the agent asked it (“Click Save? Say yes or no.”). */
  question?: string | null;
  engine: string;
  onRetry: () => void;
  onCancel: () => void;
}

const TITLE: Record<Exclude<VoiceDialogState, 'closed'>, string> = {
  listening: 'Listening…',
  processing: 'Processing…',
  nothing: 'Didn’t hear that. Try again.',
  error: 'Something went wrong.',
};

/** The tap-to-talk dialog over the side panel: the words as they come, and a big microphone. */
export function VoiceDialog({ state, final, interim, level, error, question, engine, onRetry, onCancel }: Props) {
  const micRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [state, onCancel]);

  useEffect(() => {
    if (state !== 'closed') micRef.current?.focus();
  }, [state]);

  if (state === 'closed') return null;
  const live = state === 'listening';
  const again = state === 'nothing' || state === 'error';
  const words = final || interim;
  // The rings breathe with the voice (a level from the server's detector; Chrome's speech: 1 while words come).
  const swell = live ? 1 + Math.min(1, level) * 0.35 : 1;

  return (
    <div className="voice-dialog" role="dialog" aria-modal="true" aria-label="Speak your request">
      <button type="button" className="icon-btn voice-dialog-close" aria-label="Cancel" onClick={onCancel}>
        <X size={18} />
      </button>

      <div className="voice-dialog-text" aria-live="polite">
        {question && <p className="voice-dialog-question">{question}</p>}
        <p className={`voice-dialog-title ${again ? 'is-again' : ''}`}>{words && !again ? '' : TITLE[state]}</p>
        {words && (
          <p className="voice-dialog-words">
            {final && <strong>{final}</strong>}
            {final && interim ? ' ' : ''}
            {interim && <span className="voice-dialog-interim">{interim}</span>}
          </p>
        )}
        {state === 'error' && error && <p className="voice-dialog-error">{error}</p>}
      </div>

      <div className="voice-dialog-foot">
        <button
          ref={micRef}
          type="button"
          className={`voice-dialog-mic ${live ? 'is-live' : ''} ${again ? 'is-idle' : ''}`}
          style={{ ['--swell' as string]: swell }}
          aria-label={again ? 'Try again' : live ? 'Listening' : 'Processing'}
          onClick={again ? onRetry : undefined}
          disabled={state === 'processing'}
        >
          {live && <span className="voice-dialog-ring" aria-hidden />}
          {state === 'processing' ? <Loader2 size={30} className="spin" aria-hidden /> : <Mic size={30} aria-hidden />}
        </button>
        <span className="voice-dialog-hint">
          {live ? `Pause when you’re done · ${engine}` : again ? 'Tap the microphone to speak again' : 'Sending…'}
        </span>
        <button type="button" className="voice-dialog-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
