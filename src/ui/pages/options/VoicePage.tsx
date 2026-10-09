import { Button, Input, Slider, Switch } from 'antd';
import { CheckCircle2, Mic, Square, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VoiceSettings } from '@/shared/types/config';
import { toAgentError } from '@/shared/utils/errors';
import { SPEECH_ENGINES, speechBase, speechHealth, voiceReady, type SpeechHealth } from '@/shared/voice/speech';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { micPermission, type MicPermission } from '../../voice/recorder';
import { FieldLabel, PageHeader, Section, SettingRow } from './parts';

export function VoicePage() {
  const voice = useAppSelector((s) => s.config.config.settings.voice);
  const providers = useAppSelector((s) => s.config.config.providers);
  const dispatch = useAppDispatch();
  const update = (patch: Partial<VoiceSettings>) => dispatch(configActions.updateSettings({ voice: { ...voice, ...patch } }));
  const kaggle = providers.find((p) => p.preset === 'kaggle' && p.baseUrl);

  const [health, setHealth] = useState<{ status: 'idle' | 'checking' | 'ok' | 'error'; data?: SpeechHealth; message?: string }>({ status: 'idle' });
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const [heard, setHeard] = useState<string | null>(null);
  const mic = useVoiceInput(voice, (t) => setHeard(t.text || (t.heard ? `${t.heard} (not sure)` : '')));

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

  const serverSet = !!voice.serverUrl.trim() && !!voice.key.trim();
  const engineLoaded = (id: string) => health.data?.engines.some((e) => e.id === id);

  return (
    <>
      <PageHeader
        title="Voice"
        description="Speak your requests instead of typing. Speech is recorded only while the microphone button is on, and sent to your speech server — the CareFlow Kaggle notebook."
      />

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

      <Section title="Speech engine">
        <div className="pad-block">
          <div className="radio-cards two" role="radiogroup" aria-label="Speech engine">
            {SPEECH_ENGINES.map((e) => (
              <button key={e.id} type="button" role="radio" aria-checked={voice.engine === e.id} className={`radio-card ${voice.engine === e.id ? 'on' : ''}`} onClick={() => update({ engine: e.id })}>
                <span className="radio-dot" aria-hidden />
                <span>
                  <span className="radio-title">
                    {e.label} {health.status === 'ok' && <span className={`pill ${engineLoaded(e.id) ? 'success' : 'warning'}`}>{engineLoaded(e.id) ? 'Loaded' : 'Not loaded'}</span>}
                  </span>
                  <span className="radio-text">{e.note}</span>
                </span>
              </button>
            ))}
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

      <Section title="How you talk">
        <div className="pad-block">
          <div className="radio-cards two" role="radiogroup" aria-label="Voice mode">
            {(
              [
                ['handsfree', 'Hands-free', 'Click the microphone once. It keeps listening; every pause sends what you said as a command, and the words appear live while you speak.'],
                ['push', 'Push to talk', 'Click to start, click to stop. Good for noisy rooms.'],
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
        {voice.mode === 'handsfree' ? (
          <>
            <SettingRow label="Pause before sending" description={`A command is sent after ${(voice.pauseMs / 1000).toFixed(1)} s of silence. Longer lets you think mid-sentence; shorter feels snappier.`} stacked>
              <Slider min={500} max={2500} step={100} value={voice.pauseMs} onChange={(v) => update({ pauseMs: v })} tooltip={{ formatter: (v) => `${((v ?? 0) / 1000).toFixed(1)} s` }} aria-label="Pause before sending" />
            </SettingRow>
            <SettingRow label="Live text while speaking" description="Shows your words as you say them. Sends the audio to the server every ~1 s while you speak.">
              <Switch checked={voice.livePartials} onChange={(v) => update({ livePartials: v })} aria-label="Live text while speaking" />
            </SettingRow>
            <SettingRow label="Voice replies" description="Say “confirm” or “cancel” to answer an approval, “approve all” for several, and “stop” to stop the agent. Anything else is a new request; requests made while the agent is busy wait their turn.">
              <Switch checked={voice.voiceCommands} onChange={(v) => update({ voiceCommands: v })} aria-label="Voice replies" />
            </SettingRow>
          </>
        ) : (
          <SettingRow label="Send automatically" description="Send the request as soon as your speech is transcribed. Off: the text lands in the message box so you can check it first.">
            <Switch checked={voice.autoSend} onChange={(v) => update({ autoSend: v })} aria-label="Send automatically" />
          </SettingRow>
        )}
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
        <SettingRow label="Try it" description={heard !== null ? (heard ? `Heard: “${heard}”` : 'Nothing heard.') : mic.error ?? 'Record a few words and see what the server hears.'}>
          <Button
            icon={mic.state === 'recording' ? <Square size={12} fill="currentColor" strokeWidth={0} /> : <Mic size={14} />}
            loading={mic.state === 'transcribing'}
            danger={mic.state === 'recording'}
            disabled={!voiceReady(voice) || permission === 'denied'}
            onClick={() => {
              setHeard(null);
              void (mic.state === 'recording' ? mic.stop() : mic.start());
            }}
          >
            {mic.state === 'recording' ? `Stop · ${Math.floor(mic.seconds)}s` : mic.state === 'transcribing' ? 'Transcribing' : 'Record'}
          </Button>
        </SettingRow>
      </Section>
    </>
  );
}
