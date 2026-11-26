import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceSettings } from '@/shared/types/config';
import { toAgentError } from '@/shared/utils/errors';
import { browserSpeech, transcribe, type SpeechRecognitionLike } from '@/shared/voice/speech';
import { stopSaying } from '@/shared/voice/say';
import { ContinuousListener } from '../voice/listener';
import { isFiller } from './useHandsFree';

/**
 * closed     – no dialog
 * listening  – the microphone is on; words appear as they are recognised
 * processing – the pause came: what was said is being finished and sent
 * nothing    – nothing was heard (“Didn't hear that. Try again.”)
 * error      – the microphone or the speech service failed (`error` says how)
 */
export type VoiceDialogState = 'closed' | 'listening' | 'processing' | 'nothing' | 'error';

/** Nothing said this long after the dialog opens: it stops and says so. */
const NO_SPEECH_MS = 7000;
/** One request at most this long. */
const MAX_MS = 30_000;
/** “Processing…” stays this long before the text is sent, so it can be read. */
const SHOW_MS = 450;

/**
 * Tap to talk, YouTube-style: open() starts listening in a dialog; words show live (grey while still a guess, bold
 * once sure); the first pause of `voice.pauseMs` after speech ends it, and `onDone` gets the text. Both kinds of
 * engine: Chrome's own speech recognition, or the speech server (Whisper / Omi) through the voice detector.
 */
export function useVoiceDialog(voice: VoiceSettings, onDone: (text: string) => void) {
  const [state, setState] = useState<VoiceDialogState>('closed');
  const [interim, setInterim] = useState('');
  const [final, setFinal] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);

  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  /** Everything a running session holds, so cancel() can end it from anywhere. */
  const session = useRef<{ id: number; end: () => void } | null>(null);
  const nextId = useRef(0);

  const end = useCallback(() => {
    session.current?.end();
    session.current = null;
    setLevel(0);
  }, []);

  const cancel = useCallback(() => {
    end();
    setState('closed');
    setInterim('');
    setFinal('');
    setError(null);
  }, [end]);

  const open = useCallback(async () => {
    end();
    stopSaying();
    const id = ++nextId.current;
    const alive = () => session.current?.id === id;
    const v = voiceRef.current;
    setInterim('');
    setFinal('');
    setError(null);
    setNeedsPermission(false);
    setState('listening');

    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => {
      const t = setTimeout(() => alive() && fn(), ms);
      timers.push(t);
      return t;
    };
    const clearTimers = () => timers.splice(0).forEach(clearTimeout);

    const finish = (text: string) => {
      if (!alive()) return;
      end();
      const said = text.replace(/\s+/g, ' ').trim();
      if (!said || isFiller(said)) {
        setInterim('');
        setState('nothing');
        return;
      }
      setFinal(said);
      setInterim('');
      setState('processing');
      setTimeout(() => {
        if (nextId.current !== id) return;
        setState('closed');
        doneRef.current(said);
      }, SHOW_MS);
    };
    const fail = (message: string | null, permission = false) => {
      if (!alive()) return;
      end();
      if (permission) {
        setNeedsPermission(true);
        setState('closed');
        return;
      }
      setError(message);
      setState('error');
    };

    // ---- Chrome's speech recognition
    if (v.engine === 'browser') {
      const Rec = browserSpeech();
      if (!Rec) return void fail('This Chrome has no speech recognition. Pick the speech server on the Voice page.');
      const rec: SpeechRecognitionLike = new Rec();
      rec.lang = v.lang || 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      let sure = '';
      let guess = '';
      let silence: ReturnType<typeof setTimeout> | null = null;
      // Chrome reports no level: a meter of our own shows the voice reaches the microphone, and tells
      // “no sound at all” (the wrong input device) from “sound, but Chrome wrote no words”.
      let loudest = 0;
      let soundSeen = false;
      // What Chrome did, kept on the panel's window for a look when it goes wrong (window.__voiceLog).
      const started = Date.now();
      const note = (what: string) => {
        const w = globalThis as { __voiceLog?: string[] };
        (w.__voiceLog ??= []).push(`${Date.now() - started}ms ${what} (loudest ${loudest.toFixed(3)})`);
        w.__voiceLog.splice(0, w.__voiceLog.length - 40);
      };
      note(`start ${rec.lang}`);
      const meter = { stop: () => undefined as void };
      void navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((stream) => {
          if (!alive()) return stream.getTracks().forEach((t) => t.stop());
          const ac = new AudioContext();
          const an = ac.createAnalyser();
          ac.createMediaStreamSource(stream).connect(an);
          const buf = new Float32Array(an.fftSize);
          const tick = setInterval(() => {
            an.getFloatTimeDomainData(buf);
            const rms = Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length);
            loudest = Math.max(loudest, rms);
            if (alive()) setLevel(Math.min(1, rms * 6));
          }, 100);
          meter.stop = () => {
            clearInterval(tick);
            stream.getTracks().forEach((t) => t.stop());
            void ac.close().catch(() => undefined);
          };
        })
        .catch((err) => note(`meter failed ${String(err)}`));
      rec.onsoundstart = () => {
        soundSeen = true;
        note('sound');
      };
      rec.onspeechstart = () => {
        soundSeen = true;
        note('speech');
      };
      /** Nothing written down: say why, when it can be told. */
      const noWords = () => {
        if (loudest > 0.02 || soundSeen)
          return fail('Chrome heard you but its speech service wrote no words. Try again, speaking clearly — or pick Whisper (the speech server) on the Voice page.');
        if (loudest > 0 && loudest < 0.005) return fail('The microphone isn’t picking up any sound. Check the input device in Windows sound settings (and that the mic isn’t muted).');
        finish('');
      };
      const stopNow = () => {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      };
      rec.onresult = (e) => {
        note('result');
        guess = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) sure += r[0].transcript;
          else guess += r[0].transcript;
        }
        setFinal(sure.trim());
        setInterim(guess.trim());
        if (silence) clearTimeout(silence);
        // A pause after the last words ends it.
        silence = later(voiceRef.current.pauseMs, stopNow);
      };
      rec.onerror = (e) => {
        note(`error ${e.error}`);
        if (e.error === 'aborted') return;
        if (e.error === 'no-speech') return noWords();
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') return fail(null, true);
        if (e.error === 'audio-capture') return fail('No microphone was found.');
        if (e.error === 'network') return fail('Chrome’s speech service can’t be reached — check the internet connection.');
        if (e.error === 'language-not-supported') return fail('Chrome’s speech doesn’t know that language. Pick another on the Voice page.');
        fail(`Speech recognition stopped (${e.error}).`);
      };
      rec.onend = () => {
        note('end');
        if (!alive()) return;
        // Chrome ended it by itself (a long pause): what was heard so far is the request.
        if (!`${sure}${guess}`.trim()) return noWords();
        finish(`${sure} ${guess}`);
      };
      session.current = {
        id,
        end: () => {
          clearTimers();
          meter.stop();
          rec.onresult = rec.onerror = rec.onend = rec.onspeechstart = rec.onsoundstart = null;
          try {
            rec.abort();
          } catch {
            /* not started */
          }
        },
      };
      later(NO_SPEECH_MS, () => {
        if (!sure && !guess) noWords();
      });
      later(MAX_MS, stopNow);
      try {
        rec.start();
      } catch (err) {
        fail(`Couldn’t start speech recognition (${String(err)}).`);
      }
      return;
    }

    // ---- The speech server: the voice detector cuts the request at the pause, the server writes it down.
    const ctrl = new AbortController();
    let heard = false;
    let partialBusy = false;
    const listener = new ContinuousListener(
      {
        onLevel: (l) => alive() && setLevel(l),
        onSpeechStart: () => {
          heard = true;
        },
        onPartial: (pcm) => {
          if (!voiceRef.current.livePartials || partialBusy) return;
          partialBusy = true;
          transcribe(voiceRef.current, pcm, ctrl.signal, { partial: true })
            .then((t) => alive() && setInterim(t.text || t.heard || ''))
            .catch(() => undefined)
            .finally(() => {
              partialBusy = false;
            });
        },
        onUtterance: (pcm) => {
          listener.stop();
          clearTimers();
          setLevel(0);
          setState('processing');
          transcribe(voiceRef.current, pcm, ctrl.signal)
            .then((t) => {
              if (t.unclear && t.heard) {
                if (!alive()) return;
                end();
                setInterim(t.heard);
                setState('nothing');
                return;
              }
              finish(t.text);
            })
            .catch((err) => {
              const e = toAgentError(err);
              if (e.code !== 'cancelled') fail(e.userMessage);
            });
        },
      },
      { pauseMs: v.pauseMs, partialEveryMs: 1200 },
    );
    session.current = {
      id,
      end: () => {
        clearTimers();
        listener.stop();
        ctrl.abort();
      },
    };
    later(NO_SPEECH_MS, () => {
      if (!heard) finish('');
    });
    try {
      await listener.start();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') fail(null, true);
      else fail(name === 'NotFoundError' ? 'No microphone was found.' : 'Couldn’t start the microphone.');
    }
  }, [end]);

  useEffect(() => () => end(), [end]);

  return { state, interim, final, level, error, needsPermission, open, cancel, clearPermission: () => setNeedsPermission(false) };
}
