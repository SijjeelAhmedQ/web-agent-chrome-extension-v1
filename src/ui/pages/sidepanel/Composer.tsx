import { Tooltip } from 'antd';
import { ArrowUp, Ban, Globe, Loader2, Lock, Mic, MicOff, Square, X } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { VoiceSettings } from '@/shared/types/config';
import { siteOf } from '@/shared/utils';
import { SPEECH_ENGINES, voiceReady } from '@/shared/voice/speech';
import type { ActiveTab } from '../../hooks/useActiveTab';
import { useHandsFree } from '../../hooks/useHandsFree';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { openConfiguration } from '../../utils/navigation';

export interface ComposerHandle {
  fill: (text: string) => void;
  focus: () => void;
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
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

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

  const mic = useVoiceInput(voice, (t) => {
    const spoken = t.text || t.heard || '';
    setNotice(t.unclear ? 'Not sure I heard that right — check the text before sending.' : null);
    if (voice.autoSend && !t.unclear && !running && !value.trim()) {
      onSend(spoken);
      return;
    }
    const next = value.trim() ? `${value.trimEnd()} ${spoken}` : spoken;
    setValue(next);
    focusEnd(next);
  });

  const handsFreeMode = voice.mode === 'handsfree';
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
  const recording = mic.state === 'recording';
  const transcribing = mic.state === 'transcribing';
  const engine = SPEECH_ENGINES.find((e) => e.id === voice.engine)?.label ?? 'speech';

  const onMic = () => {
    if (!ready) return void openConfiguration('/voice');
    if (handsFreeMode) return void (listening ? live.stop() : live.start());
    if (recording) return void mic.stop();
    if (!transcribing) void mic.start();
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

  const voiceMessage = mic.needsPermission || live.needsPermission ? (
    <>
      Chrome needs your OK to use the microphone.{' '}
      <button type="button" className="link-btn" onClick={() => void openConfiguration('/voice')}>
        Allow microphone
      </button>
    </>
  ) : (
    mic.error ?? live.notice ?? notice
  );

  return (
    <div className={`composer ${running ? 'is-running' : ''} ${recording ? 'is-recording' : ''}`}>
      {context && !recording && <div className="composer-top">{context}</div>}

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

      {recording || transcribing ? (
        <div className="voice-bar" role="status" aria-live="polite">
          {recording ? (
            <>
              <span className="rec-dot" aria-hidden />
              <span className="voice-label">Listening</span>
              <span className="voice-meter" aria-hidden>
                {[0.55, 0.85, 1, 0.75, 0.5].map((w, i) => (
                  <span key={i} style={{ transform: `scaleY(${Math.max(0.15, Math.min(1, mic.level * w * 1.6))})` }} />
                ))}
              </span>
              <span className="voice-time">{clock(mic.seconds)}</span>
              <button type="button" className="icon-btn small" aria-label="Cancel recording" onClick={mic.cancel}>
                <X size={15} />
              </button>
            </>
          ) : (
            <>
              <Loader2 size={15} className="spin" aria-hidden />
              <span className="voice-label">Transcribing with {engine}…</span>
              <button type="button" className="icon-btn small" aria-label="Cancel transcription" onClick={mic.cancel}>
                <X size={15} />
              </button>
            </>
          )}
        </div>
      ) : (
        <>
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
        </>
      )}

      {voiceMessage && !recording && !transcribing && (
        <div className="voice-note" role="alert">
          <span>{voiceMessage}</span>
          <button
            type="button"
            className="icon-btn small"
            aria-label="Dismiss"
            onClick={() => {
              mic.clearError();
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
                : recording
                  ? 'Stop and transcribe'
                  : `Speak (${engine})`
          }
        >
          <button
            type="button"
            className={`icon-btn mic-btn ${recording ? 'on' : ''} ${listening ? 'live' : ''}`}
            aria-label={!ready ? 'Set up voice input' : handsFreeMode ? (listening ? 'Stop listening' : 'Start hands-free voice') : recording ? 'Stop recording and transcribe' : 'Start voice input'}
            aria-pressed={recording || listening}
            onClick={onMic}
            disabled={transcribing}
          >
            {listening ? <MicOff size={16} /> : recording ? <Square size={13} fill="currentColor" strokeWidth={0} /> : <Mic size={17} />}
          </button>
        </Tooltip>
        <span className="composer-hint" aria-hidden>
          {recording ? (
            <>
              Click <span className="kbd">■</span> when you’re done
            </>
          ) : running ? (
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
          <button type="button" className="send-btn" onClick={submit} disabled={!value.trim() || disabled || recording || transcribing} aria-label="Send">
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  );
});
