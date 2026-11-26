// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { useVoiceDialog } from './useVoiceDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Chrome's recogniser, driven by the test. */
class FakeRecognition {
  static last: FakeRecognition;
  lang = '';
  continuous = false;
  interimResults = false;
  started = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {}
  /** Results so far: [text, final?] each. */
  say(...results: [string, boolean][]) {
    this.onresult?.({ resultIndex: 0, results: results.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } })) });
  }
}

type Dialog = ReturnType<typeof useVoiceDialog>;

function mount(onDone: (t: string) => void) {
  const voice = { ...DEFAULT_SETTINGS.voice, enabled: true, engine: 'browser' as const, lang: 'ur-PK', pauseMs: 1500 };
  const ref: { current: Dialog | null } = { current: null };
  const Probe = () => {
    ref.current = useVoiceDialog(voice, onDone);
    return null;
  };
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
  return { ref, unmount: () => act(() => root.unmount()) };
}

describe('tap-to-talk dialog with Chrome speech', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it('shows the words as they come, and sends them after the pause', async () => {
    const done = vi.fn();
    const { ref, unmount } = mount(done);
    await act(() => ref.current!.open());
    const rec = FakeRecognition.last;
    expect(rec.started && rec.lang === 'ur-PK' && rec.continuous && rec.interimResults).toBe(true);
    expect(ref.current!.state).toBe('listening');

    act(() => rec.say(['open sta', false]));
    expect(ref.current!.interim).toBe('open sta');
    act(() => rec.say(['open stations', true]));
    expect(ref.current!.final).toBe('open stations');
    expect(ref.current!.interim).toBe('');

    // Still speaking at 1 s: not sent yet.
    act(() => vi.advanceTimersByTime(1000));
    expect(ref.current!.state).toBe('listening');
    // The pause (1.5 s) ends it: “Processing…”, then the text goes.
    act(() => vi.advanceTimersByTime(600));
    expect(ref.current!.state).toBe('processing');
    expect(done).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(done).toHaveBeenCalledWith('open stations');
    expect(ref.current!.state).toBe('closed');
    unmount();
  });

  it('says it heard nothing after 7 s of silence, and can try again', async () => {
    const done = vi.fn();
    const { ref, unmount } = mount(done);
    await act(() => ref.current!.open());
    act(() => vi.advanceTimersByTime(7100));
    expect(ref.current!.state).toBe('nothing');
    await act(() => ref.current!.open());
    expect(ref.current!.state).toBe('listening');
    act(() => ref.current!.cancel());
    expect(ref.current!.state).toBe('closed');
    act(() => vi.advanceTimersByTime(10_000));
    expect(done).not.toHaveBeenCalled();
    unmount();
  });

  it('asks for the microphone when Chrome refuses it', async () => {
    const { ref, unmount } = mount(vi.fn());
    await act(() => ref.current!.open());
    act(() => FakeRecognition.last.onerror?.({ error: 'not-allowed' }));
    expect(ref.current!.state).toBe('closed');
    expect(ref.current!.needsPermission).toBe(true);
    unmount();
  });
});
