import { Tooltip } from 'antd';
import { ArrowUp, Ban, Globe, Lock, Mic, MicOff, Square, X } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { VoiceSettings } from '@/shared/types/config';
import { siteOf } from '@/shared/utils';
import { SPEECH_ENGINES, voiceReady } from '@/shared/voice/speech';
import type { ActiveTab } from '../../hooks/useActiveTab';
import { useHandsFree } from '../../hooks/useHandsFree';
import { useVoiceDialog } from '../../hooks/useVoiceDialog';
import { openConfiguration } from '../../utils/navigation';
import { VoiceDialog } from './VoiceDialog';

export interface ComposerHandle {
  fill: (text: string) => void;
  focus: () => void;
  /** Open the tap-to-talk dialog (e.g. to hear the answer to a question just spoken), with that question in it. */
  listen: (question?: string) => void;
}

interface Props {
  tab: ActiveTab;
  running: boolean;
  disabled: boolean;
  siteMode: 'normal' | 'read-only' | 'blocked';
  voice: VoiceSettings;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Hands-free mode: every spoken command goes here (it may be “confirm”, “stop”…). */
  onVoiceCommand: (text: string) => void;
  /** An approval is waiting — hands-free prompts for “confirm” / “cancel”. */
  approvalPending?: boolean;
}

const MAX_HEIGHT = 180;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ tab, running, disabled, siteMode, voice, onSend, onStop, onVoiceCommand, approvalPending }, ref) {
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const focusEnd = (text: string) =>
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });

  // Tap to talk: a pause ends what you say, and it runs as you said it — shown in the chat like a typed request.
  const [question, setQuestion] = useState<string | null>(null);
  const dialog = useVoiceDialog(voice, (text) => {
    setQuestion(null);
    setNotice(null);
    onVoiceCommand(text);
  });
  const talking = dialog.state !== 'closed';

  // Chrome's own speech has no hands-free listening here: its microphone button opens the dialog.
  const handsFreeMode = voice.mode === 'handsfree' && voice.engine !== 'browser';
  const live = useHandsFree(voice, onVoiceCommand);
  const listening = live.state !== 'off';

  useImperativeHandle(ref, () => ({
    fill(text) {
      setValue(text);
      focusEnd(text);
    },
    focus() {
      area.current?.focus();
    },
    listen(q) {
      if (!voiceReady(voice) || listening) return;
      setQuestion(q ?? null);
      void dialog.open();
    },
  }));

  // Auto-grow.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = () => {
    if (running || disabled || !value.trim()) return;
    onSend(value);
    setValue('');
    setNotice(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const ready = voiceReady(voice);
  const engine = SPEECH_ENGINES.find((e) => e.id === voice.engine)?.short ?? 'speech';

  const onMic = () => {
    if (!ready) return void openConfiguration('/voice');
    if (handsFreeMode) return void (listening ? live.stop() : live.start());
    setQuestion(null);
    void dialog.open();
  };

  const closeDialog = () => {
    setQuestion(null);
    dialog.cancel();
  };

  // Turning voice off or switching to push-to-talk ends hands-free listening.
  useEffect(() => {
    if ((!ready || !handsFreeMode) && listening) live.stop();
  }, [ready, handsFreeMode, listening, live]);

  const site = siteOf(tab.url);
  const context = tab.restricted ? (
    <Tooltip title={tab.restricted}>
      <span className="ctx-chip warn">
        <Ban size={12} aria-hidden /> Can’t work on this page
      </span>
    </Tooltip>
  ) : site ? (
    <span className={`ctx-chip ${siteMode !== 'normal' ? 'warn' : ''}`} title={tab.title}>
      {tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl) ? <img src={tab.favIconUrl} alt="" width={12} height={12} /> : <Globe size={12} aria-hidden />}
      <span className="ctx-site">{site}</span>
      {siteMode === 'read-only' && (
        <>
          <Lock size={11} aria-hidden /> Read only
        </>
      )}
      {siteMode === 'blocked' && (
        <>
          <Ban size={11} aria-hidden /> Blocked
        </>
      )}
    </span>
  ) : null;

  const voiceMessage = dialog.needsPermission || live.needsPermission ? (
    <>
      Chrome needs your OK to use the microphone.{' '}
      <button type="button" className="link-btn" onClick={() => void openConfiguration('/voice')}>
        Allow microphone
      </button>
    </>
  ) : (
    live.notice ?? notice
  );

  return (
    <div className={`composer ${running ? 'is-running' : ''}`}>
      <VoiceDialog
        state={dialog.state}
        final={dialog.final}
        interim={dialog.interim}
        level={dialog.level}
        error={dialog.error}
        question={question}
        engine={engine}
        onRetry={() => void dialog.open()}
        onCancel={closeDialog}
      />
      {context && <div className="composer-top">{context}</div>}

      {listening && (
        <div className={`live-bar ${live.state}`} role="status" aria-live="polite">
          <span className="rec-dot" aria-hidden />
          <span className="live-text">
            {live.state === 'hearing' ? (
              live.partial ? <span className="live-partial">{live.partial}</span> : <span className="voice-label">Hearing you…</span>
            ) : live.pending ? (
              <span className="voice-label">Running your command…</span>
            ) : approvalPending && voice.voiceCommands ? (
              <span className="live-ask">Waiting for you — say “confirm” or “cancel”</span>
            ) : live.lastCommand ? (
              <span className="live-last">
                Sent: “{live.lastCommand}”<span className="live-hint"> · listening</span>
              </span>
            ) : (
              <span className="voice-label">Listening — pause to send{voice.voiceCommands ? ' · say “stop” or “confirm”' : ''}</span>
            )}
          </span>
          <span className="voice-meter" aria-hidden>
            {[0.55, 0.85, 1, 0.75, 0.5].map((w, i) => (
              <span key={i} style={{ transform: `scaleY(${Math.max(0.15, Math.min(1, live.level * w * 1.6))})` }} />
            ))}
          </span>
        </div>
      )}

      <label htmlFor="composer-input" className="sr-only">
        Message
      </label>
      <textarea
        id="composer-input"
        ref={area}
        rows={1}
        value={value}
        placeholder={running ? 'Working… you can type your next request' : 'Ask anything, or describe a task…'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        spellCheck
      />

      {voiceMessage && (
        <div className="voice-note" role="alert">
          <span>{voiceMessage}</span>
          <button
            type="button"
            className="icon-btn small"
            aria-label="Dismiss"
            onClick={() => {
              dialog.clearPermission();
              live.clearNotice();
              setNotice(null);
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="composer-bar">
        <Tooltip
          title={
            !ready
              ? 'Set up voice input'
              : handsFreeMode
                ? listening
                  ? 'Stop listening'
                  : `Talk hands-free (${engine}) — each pause sends a command`
                : `Speak (${engine})`
          }
        >
          <button
            type="button"
            className={`icon-btn mic-btn ${talking ? 'on' : ''} ${listening ? 'live' : ''}`}
            aria-label={!ready ? 'Set up voice input' : handsFreeMode ? (listening ? 'Stop listening' : 'Start hands-free voice') : 'Start voice input'}
            aria-pressed={talking || listening}
            onClick={onMic}
          >
            {listening ? <MicOff size={16} /> : <Mic size={17} />}
          </button>
        </Tooltip>
        <span className="composer-hint" aria-hidden>
          {running ? (
            <>
              <span className="kbd">Esc</span> to stop
            </>
          ) : value ? (
            <>
              <span className="kbd">↵</span> to send · <span className="kbd">⇧↵</span> new line
            </>
          ) : null}
        </span>
        {running ? (
          <button type="button" className="stop-btn" onClick={onStop} aria-label="Stop the agent">
            <Square size={11} fill="currentColor" strokeWidth={0} />
            Stop
          </button>
        ) : (
          <button type="button" className="send-btn" onClick={submit} disabled={!value.trim() || disabled} aria-label="Send">
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  );
});
