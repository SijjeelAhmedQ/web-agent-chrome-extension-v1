import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceSettings } from '@/shared/types/config';
import { toAgentError } from '@/shared/utils/errors';
import { transcribe, type Transcript } from '@/shared/voice/speech';
import { PcmRecorder } from '../voice/recorder';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

const MAX_SECONDS = 60;

/**
 * Push-to-talk: start() records, stop() sends the speech to the server and calls onResult
 * with the text. Errors come back as friendly messages; `needsPermission` means the side
 * panel can't show Chrome's microphone prompt and the user must allow it on the Voice page.
 */
export function useVoiceInput(voice: VoiceSettings, onResult: (t: Transcript) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const recorder = useRef<PcmRecorder | null>(null);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const stop = useCallback(async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    clearTimer();
    const pcm = await rec.stop();
    setLevel(0);
    if (pcm.length < 16000 * 0.3) {
      setState('idle');
      setError('That was too short — hold on a moment longer while you speak.');
      return;
    }
    setState('transcribing');
    abort.current = new AbortController();
    try {
      const t = await transcribe(voice, pcm, abort.current.signal);
      if (!t.text && !t.heard) setError("I didn't hear any words. Try again a little closer to the microphone.");
      else resultRef.current(t);
    } catch (err) {
      const e = toAgentError(err);
      if (e.code !== 'cancelled') setError(e.userMessage);
    } finally {
      abort.current = null;
      setState('idle');
    }
  }, [voice]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    setError(null);
    setNeedsPermission(false);
    const rec = new PcmRecorder(setLevel);
    try {
      await rec.start();
    } catch (err) {
      rec.cancel();
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setNeedsPermission(true);
      else if (name === 'NotFoundError') setError('No microphone was found.');
      else setError("Couldn't start the microphone.");
      return;
    }
    recorder.current = rec;
    setSeconds(0);
    setState('recording');
    timer.current = setInterval(() => {
      const s = rec.seconds;
      setSeconds(s);
      if (s >= MAX_SECONDS) void stop();
    }, 200);
  }, [state, stop]);

  const cancel = useCallback(() => {
    clearTimer();
    recorder.current?.cancel();
    recorder.current = null;
    abort.current?.abort();
    setLevel(0);
    setState('idle');
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  return { state, level, seconds, error, needsPermission, start, stop, cancel, clearError: () => setError(null) };
}
