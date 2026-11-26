import { Button, Input, Select, Slider, Switch } from 'antd';
import { CheckCircle2, Mic, Square, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VoiceSettings } from '@/shared/types/config';
import { toAgentError } from '@/shared/utils/errors';
import { say } from '@/shared/voice/say';
import { browserSpeech, SPEECH_ENGINES, SPEECH_LANGUAGES, speechBase, speechHealth, voiceReady, type SpeechHealth } from '@/shared/voice/speech';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { useVoiceDialog } from '../../hooks/useVoiceDialog';
import { micPermission, type MicPermission } from '../../voice/recorder';
import { FieldLabel, PageHeader, Section, SettingRow } from './parts';
import { SectionGroup } from './layout';

export function VoicePage() {
  const voice = useAppSelector((s) => s.config.config.settings.voice);
  const providers = useAppSelector((s) => s.config.config.providers);
  const dispatch = useAppDispatch();
  const update = (patch: Partial<VoiceSettings>) => dispatch(configActions.updateSettings({ voice: { ...voice, ...patch } }));
  const kaggle = providers.find((p) => p.preset === 'kaggle' && p.baseUrl);

  const [health, setHealth] = useState<{ status: 'idle' | 'checking' | 'ok' | 'error'; data?: SpeechHealth; message?: string }>({ status: 'idle' });
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const [heard, setHeard] = useState<string | null>(null);
  // “Try it” listens just as the side panel's microphone does — with the engine, language and pause set here.
  const trial = useVoiceDialog(voice, setHeard);

  useEffect(() => {
    void micPermission().then(setPermission);
  }, []);

  const check = async () => {
    setHealth({ status: 'checking' });
    try {
      setHealth({ status: 'ok', data: await speechHealth(voice) });
    } catch (err) {
      setHealth({ status: 'error', message: toAgentError(err).userMessage });
    }
  };

  const allowMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* the state below says what happened */
    }
    setPermission(await micPermission());
  };

  const browser = voice.engine === 'browser';
  const chromeHasSpeech = !!browserSpeech();
  const serverSet = !!voice.serverUrl.trim() && !!voice.key.trim();
  const engineLoaded = (id: string) => health.data?.engines.some((e) => e.id === id);
  const handsFree = voice.mode === 'handsfree' && !browser;
  const lang = voice.lang || 'en-US';

  const trialText =
    trial.state === 'listening'
      ? trial.final || trial.interim
        ? `Listening… “${[trial.final, trial.interim].filter(Boolean).join(' ')}”`
        : 'Listening… say a few words, then pause.'
      : trial.state === 'processing'
        ? 'Processing…'
        : trial.state === 'nothing'
          ? 'Didn’t hear that. Try again.'
          : trial.state === 'error'
            ? (trial.error ?? 'Something went wrong.')
            : trial.needsPermission
              ? 'Allow the microphone first (above).'
              : heard !== null
                ? `Heard: “${heard}”`
                : 'Say a few words and see what it hears.';

  return (
    <>
      <PageHeader
        title="Voice"
        description="Speak your requests instead of typing. The microphone is on only while the listening dialog is open (or hands-free is on)."
      />

      <SectionGroup>
        <Section title="Speech engine">
          <div className="pad-block">
            <div className="radio-cards two" role="radiogroup" aria-label="Speech engine">
              {SPEECH_ENGINES.map((e) => (
                <button key={e.id} type="button" role="radio" aria-checked={voice.engine === e.id} className={`radio-card ${voice.engine === e.id ? 'on' : ''}`} onClick={() => update({ engine: e.id })}>
                  <span className="radio-dot" aria-hidden />
                  <span>
                    <span className="radio-title">
                      {e.label}{' '}
                      {e.id === 'browser'
                        ? !chromeHasSpeech && <span className="pill warning">Not in this Chrome</span>
                        : health.status === 'ok' && <span className={`pill ${engineLoaded(e.id) ? 'success' : 'warning'}`}>{engineLoaded(e.id) ? 'Loaded' : 'Not loaded'}</span>}
                    </span>
                    <span className="radio-text">{e.note}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="two-col" style={{ marginTop: 16 }}>
              <div>
                <FieldLabel htmlFor="voice-lang">Language you speak</FieldLabel>
                <Select id="voice-lang" style={{ width: '100%' }} value={lang} onChange={(v) => update({ lang: v })} options={SPEECH_LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} />
                <div className="field-help">
                  {lang === 'en-US'
                    ? 'Requests, and “yes” / “no” to an approval.'
                    : voice.engine === 'omi'
                      ? 'Omi knows English only — pick Whisper or Chrome speech for this language.'
                      : voice.engine === 'whisper'
                        ? 'Whisper knows it. Run the updated Kaggle notebook once, or the server keeps listening for English. “Haan” / “nahi” answer an approval.'
                        : '“Haan” / “nahi” (or “yes” / “no”) answer an approval.'}
                </div>
              </div>
            </div>
            {voice.engine === 'whisper' && (
              <div style={{ marginTop: 16 }}>
                <FieldLabel htmlFor="voice-vocab" hint="Optional">
                  Vocabulary
                </FieldLabel>
                <Input.TextArea
                  id="voice-vocab"
                  value={voice.vocabulary}
                  onChange={(e) => update({ vocabulary: e.target.value })}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  placeholder="Names and terms to expect, e.g. Tom Baker, Amoxicillin, Paracetamol, MRN"
                />
                <div className="field-help">Whisper uses this to spell names and medical terms correctly.</div>
              </div>
            )}
          </div>
        </Section>

        {!browser && (
          <Section title="Speech server" description="Run kaggle/careflow_kaggle.ipynb on Kaggle (GPU T4, Internet on). It prints an address and a key.">
            <div className="pad-block form-stack">
              <div className="two-col">
                <div>
                  <FieldLabel htmlFor="voice-url">Server address</FieldLabel>
                  <Input id="voice-url" className="mono" value={voice.serverUrl} onChange={(e) => update({ serverUrl: e.target.value })} placeholder="https://xxxx.trycloudflare.com" />
                </div>
                <div>
                  <FieldLabel htmlFor="voice-key">Notebook key</FieldLabel>
                  <Input.Password id="voice-key" value={voice.key} onChange={(e) => update({ key: e.target.value })} placeholder="The KEY from the notebook" autoComplete="off" />
                </div>
              </div>
              <div className="row-gap align-center">
                <Button onClick={() => void check()} loading={health.status === 'checking'} disabled={!serverSet}>
                  Check server
                </Button>
                {kaggle && speechBase(kaggle.baseUrl) !== speechBase(voice.serverUrl) && (
                  <Button type="link" onClick={() => update({ serverUrl: speechBase(kaggle.baseUrl), key: kaggle.apiKey })}>
                    Use my “{kaggle.name}” connection
                  </Button>
                )}
              </div>
              {health.status === 'error' && (
                <div className="test-banner error" role="alert">
                  <XCircle size={16} /> {health.message}
                </div>
              )}
              {health.status === 'ok' && health.data && (
                <div className="test-banner ok" role="status">
                  <CheckCircle2 size={16} />
                  <span>
                    Connected{health.data.gpu ? ` · ${health.data.gpu.split(',')[0]}` : ''}. Speech: {health.data.engines.map((e) => `${e.model} (${e.device})`).join(', ') || 'none loaded'}.
                    {health.data.models.length > 0 && ` Models: ${health.data.models.join(', ')}.`}
                  </span>
                </div>
              )}
            </div>
          </Section>
        )}

        <Section title="How you talk">
          <div className="pad-block">
            <div className="radio-cards two" role="radiogroup" aria-label="Voice mode">
              {(
                [
                  ['push', 'Tap to talk', 'Tap the microphone: a listening dialog opens and your words appear as you speak. Pause, and it runs what you said.'],
                  ['handsfree', 'Hands-free', browser ? 'Needs the speech server (Whisper or Omi). With Chrome speech, the microphone opens the tap-to-talk dialog.' : 'Click the microphone once. It keeps listening; every pause sends what you said as a command.'],
                ] as const
              ).map(([value, title, text]) => (
                <button key={value} type="button" role="radio" aria-checked={voice.mode === value} className={`radio-card ${voice.mode === value ? 'on' : ''}`} onClick={() => update({ mode: value })}>
                  <span className="radio-dot" aria-hidden />
                  <span>
                    <span className="radio-title">{title}</span>
                    <span className="radio-text">{text}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <SettingRow label="Voice input" description="Shows a working microphone button in the side panel.">
            <Switch checked={voice.enabled} onChange={(v) => update({ enabled: v })} aria-label="Voice input" />
          </SettingRow>
          <SettingRow label="Pause before sending" description={`What you said is sent after ${(voice.pauseMs / 1000).toFixed(1)} s of silence. Longer lets you think mid-sentence; shorter feels snappier.`} stacked>
            <Slider min={500} max={2500} step={100} value={voice.pauseMs} onChange={(v) => update({ pauseMs: v })} tooltip={{ formatter: (v) => `${((v ?? 0) / 1000).toFixed(1)} s` }} aria-label="Pause before sending" />
          </SettingRow>
          {!browser && (
            <SettingRow label="Live text while speaking" description="Shows your words as you say them. Sends the audio to the server every ~1 s while you speak.">
              <Switch checked={voice.livePartials} onChange={(v) => update({ livePartials: v })} aria-label="Live text while speaking" />
            </SettingRow>
          )}
          <SettingRow
            label="Voice replies"
            description={`Say “yes” or “no” to an approval, “approve all” for several, and “stop” to stop the agent. “Open stations”, “go to messages” go straight to that page of the site's map — no model needed.${handsFree ? ' Requests made while the agent is busy wait their turn.' : ''}`}
          >
            <Switch checked={voice.voiceCommands} onChange={(v) => update({ voiceCommands: v })} aria-label="Voice replies" />
          </SettingRow>
          <SettingRow label="Spoken replies" description="For a request you spoke: its approval question is said aloud — then the microphone listens for your yes or no — and so is what was done.">
            <span className="row-gap align-center">
              <Button size="small" onClick={() => void say('Click Save? Say yes or no.', lang)}>
                Hear it
              </Button>
              <Switch checked={voice.speak} onChange={(v) => update({ speak: v })} aria-label="Spoken replies" />
            </span>
          </SettingRow>
        </Section>

        <Section title="Microphone" description="Chrome can't ask for the microphone inside the side panel, so allow it once here.">
          <SettingRow
            label="Permission"
            description={permission === 'granted' ? 'Allowed.' : permission === 'denied' ? 'Blocked. Allow the microphone for this extension in Chrome’s site settings, then reload this page.' : 'Not allowed yet.'}
          >
            {permission === 'granted' ? (
              <span className="pill success">Allowed</span>
            ) : (
              <Button type="primary" icon={<Mic size={14} />} onClick={() => void allowMic()} disabled={permission === 'denied'}>
                Allow microphone
              </Button>
            )}
          </SettingRow>
          <SettingRow label="Try it" description={<span aria-live="polite">{trialText}</span>}>
            <Button
              icon={trial.state === 'listening' ? <Square size={12} fill="currentColor" strokeWidth={0} /> : <Mic size={14} />}
              loading={trial.state === 'processing'}
              danger={trial.state === 'listening'}
              disabled={!voiceReady(voice) || permission === 'denied'}
              onClick={() => {
                setHeard(null);
                if (trial.state === 'listening') trial.cancel();
                else void trial.open();
              }}
            >
              {trial.state === 'listening' ? 'Stop' : trial.state === 'processing' ? 'Processing' : 'Speak'}
            </Button>
          </SettingRow>
        </Section>
      </SectionGroup>
    </>
  );
}
