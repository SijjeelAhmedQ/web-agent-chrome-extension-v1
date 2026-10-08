import { Tooltip } from 'antd';
import { ArrowUp, Ban, Globe, Lock, Mic, Square } from 'lucide-react';
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { siteOf } from '@/shared/utils';
import type { ActiveTab } from '../../hooks/useActiveTab';

export interface ComposerHandle {
  fill: (text: string) => void;
  focus: () => void;
}

interface Props {
  tab: ActiveTab;
  running: boolean;
  disabled: boolean;
  siteMode: 'normal' | 'read-only' | 'blocked';
  onSend: (text: string) => void;
  onStop: () => void;
}

const MAX_HEIGHT = 180;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ tab, running, disabled, siteMode, onSend, onStop }, ref) {
  const [value, setValue] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    fill(text) {
      setValue(text);
      requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(text.length, text.length);
      });
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
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

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

  return (
    <div className={`composer ${running ? 'is-running' : ''}`}>
      {context && <div className="composer-top">{context}</div>}
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
      <div className="composer-bar">
        <Tooltip title="Voice input is coming soon">
          <span>
            <button type="button" className="icon-btn" aria-label="Voice input (coming soon)" disabled>
              <Mic size={17} />
            </button>
          </span>
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
