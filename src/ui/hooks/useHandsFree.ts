import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceSettings } from '@/shared/types/config';
import { toAgentError } from '@/shared/utils/errors';
import { onSpeaking } from '@/shared/voice/say';
import { transcribe } from '@/shared/voice/speech';
import { ContinuousListener } from '../voice/listener';

export type HandsFreeState = 'off' | 'listening' | 'hearing';

/** What Whisper “hears” in noise and silence — never a command. */
const FILLERS = new Set(['', 'you', 'thank you', 'thanks', 'thank you very much', 'thanks for watching', 'bye', 'uh', 'um', 'hmm', 'mm', 'oh', 'ah']);

export const isFiller = (text: string) => FILLERS.has(text.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim());

/**
 * Hands-free voice: once started, the microphone stays on. Words appear live while you speak;
 * each pause turns what you said into a command (`onCommand`), transcribed one after another.
 */
export function useHandsFree(voice: VoiceSettings, onCommand: (text: string) => void) {
  const [state, setState] = useState<HandsFreeState>('off');
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState('');
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const listener = useRef<ContinuousListener | null>(null);
  const utterance = useRef(0);
  const partialBusy = useRef(false);
  const finals = useRef<Promise<void>>(Promise.resolve());
  const abort = useRef<AbortController | null>(null);
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const stop = useCallback(() => {
    listener.current?.stop();
    listener.current = null;
    abort.current?.abort();
    abort.current = null;
    setState('off');
    setLevel(0);
    setPartial('');
  }, []);

  const start = useCallback(async () => {
    if (listener.current) return;
    setNotice(null);
    setNeedsPermission(false);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const l = new ContinuousListener(
      {
        onLevel: setLevel,
        onSpeechStart: () => {
          utterance.current++;
          setState('hearing');
          setPartial('');
          setNotice(null);
        },
        onPartial: (pcm) => {
          if (!voiceRef.current.livePartials || partialBusy.current) return;
          partialBusy.current = true;
          const n = utterance.current;
          transcribe(voiceRef.current, pcm, ctrl.signal, { partial: true })
            .then((t) => {
              if (n === utterance.current && listener.current) setPartial(t.text || t.heard || '');
            })
            .catch(() => undefined)
            .finally(() => {
              partialBusy.current = false;
            });
        },
        onDiscard: () => {
          setState('listening');
          setPartial('');
        },
        onUtterance: (pcm) => {
          setState('listening');
          setPending((p) => p + 1);
          // Commands are transcribed and run in the order they were spoken.
          finals.current = finals.current.then(async () => {
            try {
              const t = await transcribe(voiceRef.current, pcm, ctrl.signal);
              const text = t.text.trim();
              if (t.unclear || !text || isFiller(text)) {
                setNotice(t.unclear && t.heard ? `Didn’t catch that clearly (“${t.heard}”) — say it again.` : 'Didn’t catch that — say it again.');
              } else {
                setLastCommand(text);
                commandRef.current(text);
              }
            } catch (err) {
              const e = toAgentError(err);
              if (e.code !== 'cancelled') setNotice(e.userMessage);
            } finally {
              setPending((p) => Math.max(0, p - 1));
              setPartial('');
            }
          });
        },
      },
      { pauseMs: voiceRef.current.pauseMs, partialEveryMs: 1200 },
    );
    try {
      await l.start();
    } catch (err) {
      l.stop();
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setNeedsPermission(true);
      else setNotice(name === 'NotFoundError' ? 'No microphone was found.' : "Couldn't start the microphone.");
      return;
    }
    listener.current = l;
    setState('listening');
  }, []);

  // While the extension speaks (an approval question, “Okay.”), the microphone doesn't take it down as a command.
  useEffect(() => onSpeaking((on) => listener.current?.setPaused(on)), []);

  // Restart with the new pause length when it changes.
  useEffect(() => {
    if (!listener.current) return;
    stop();
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.pauseMs]);

  useEffect(() => stop, [stop]);

  return { state, level, partial, pending, notice, lastCommand, needsPermission, start, stop, clearNotice: () => setNotice(null) };
}
