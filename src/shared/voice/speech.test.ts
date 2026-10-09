import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@/agent/llm';
import { DEFAULT_SETTINGS } from '../constants/defaults';
import { knownModel, presetById, withApiPath } from '../constants/providers';
import { speechBase, speechHealth, transcribe, voiceReady } from './speech';

afterEach(() => vi.unstubAllGlobals());

const voice = { ...DEFAULT_SETTINGS.voice, enabled: true, serverUrl: 'https://abc.trycloudflare.com/vllm/v1', key: 'secret', vocabulary: 'Tom Baker, Amoxicillin' };

describe('Kaggle preset', () => {
  it('adds the API path to a bare address only', () => {
    expect(withApiPath('https://abc.trycloudflare.com/', '/vllm/v1')).toBe('https://abc.trycloudflare.com/vllm/v1');
    expect(withApiPath('https://abc.trycloudflare.com/vllm/v1', '/vllm/v1')).toBe('https://abc.trycloudflare.com/vllm/v1');
    expect(withApiPath('http://localhost:8000/v1', undefined)).toBe('http://localhost:8000/v1');
  });
  it('knows which models can act', () => {
    expect(knownModel('qwen3.5:9b')?.tools).toBe(true);
    expect(knownModel('ternary-bonsai-2-27b')?.tools).toBe(true);
    expect(knownModel('hf.co/unsloth/medgemma-4b-it-GGUF:Q4_K_M')?.tools).toBe(false);
    expect(knownModel('some/medgemma-27b')?.tools).toBe(false);
    expect(knownModel('gpt-4.1-mini')).toBeUndefined();
  });
  it('sends the notebook key in X-CareFlow-Key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const preset = presetById('kaggle');
    await createClient({ id: 'k', name: 'Kaggle', kind: preset.kind, preset: 'kaggle', baseUrl: 'https://abc.trycloudflare.com/vllm/v1', apiKey: 'secret', defaultModel: 'qwen3.5:9b', keyHeader: preset.keyHeader, createdAt: 0 }).chat({
      model: 'qwen3.5:9b',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      temperature: 0,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://abc.trycloudflare.com/vllm/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-CareFlow-Key']).toBe('secret');
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('speech server client', () => {
  it('reduces any pasted address to the server root', () => {
    expect(speechBase('https://abc.trycloudflare.com/vllm/v1')).toBe('https://abc.trycloudflare.com');
  });
  it('posts 16-bit PCM with engine, vocabulary and key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: ' Open Tom Baker ', unclear: false, ms: 210 })));
    vi.stubGlobal('fetch', fetchMock);
    const t = await transcribe(voice, new Int16Array(16000));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://abc.trycloudflare.com/transcribe');
    expect(u.searchParams.get('engine')).toBe('whisper');
    expect(u.searchParams.get('prompt')).toBe('Tom Baker, Amoxicillin');
    expect((init.headers as Record<string, string>)['X-CareFlow-Key']).toBe('secret');
    expect((init.body as ArrayBuffer).byteLength).toBe(32000);
    expect(t).toEqual({ text: 'Open Tom Baker', unclear: false, heard: undefined, ms: 210 });
  });
  it('sends no vocabulary to Omi and explains a wrong key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: 'Wrong or missing X-CareFlow-Key' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(transcribe({ ...voice, engine: 'omi' }, new Int16Array(8000))).rejects.toMatchObject({ code: 'model_auth' });
    expect(new URL((fetchMock.mock.calls[0] as unknown as [string])[0]).searchParams.has('prompt')).toBe(false);
  });
  it('reads the health report', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ default: 'whisper', gpu: 'Tesla T4, 9000 MiB, 15360 MiB', engines: { whisper: { model: 'whisper-large-v3-turbo', device: 'cuda' } }, llm: { models: ['qwen3.5:9b'], loaded: ['qwen3.5:9b'], bonsai: 'ready' } })),
      ),
    );
    const h = await speechHealth(voice);
    expect(h.engines).toEqual([{ id: 'whisper', model: 'whisper-large-v3-turbo', device: 'cuda' }]);
    expect(h.bonsai).toBe('ready');
  });
  it('is ready only when switched on with an address and key', () => {
    expect(voiceReady(voice)).toBe(true);
    expect(voiceReady({ ...voice, key: '' })).toBe(false);
    expect(voiceReady({ ...voice, enabled: false })).toBe(false);
  });
});

describe('hands-free voice replies', () => {
  it('treats short replies as approvals, stop or a new request', async () => {
    const { parseVoiceCommand } = await import('./commands');
    const waiting = { approvalPending: true, running: true };
    expect(parseVoiceCommand('Confirm.', waiting)).toEqual({ kind: 'approve' });
    expect(parseVoiceCommand('Yes, please', waiting)).toEqual({ kind: 'approve' });
    expect(parseVoiceCommand('Approve all', waiting)).toEqual({ kind: 'approve-all' });
    expect(parseVoiceCommand('No.', waiting)).toEqual({ kind: 'decline' });
    expect(parseVoiceCommand('Stop!', { approvalPending: false, running: true })).toEqual({ kind: 'stop' });
    expect(parseVoiceCommand('Cancel', { approvalPending: false, running: true })).toEqual({ kind: 'stop' });
    // Whole utterances only: these are requests.
    expect(parseVoiceCommand('Confirm the booking for Friday', waiting).kind).toBe('request');
    expect(parseVoiceCommand('Stop', { approvalPending: false, running: false }).kind).toBe('request');
    expect(parseVoiceCommand('yes', { approvalPending: false, running: false }).kind).toBe('request');
  });
  it('ignores what speech models hear in silence', async () => {
    const { isFiller } = await import('@/ui/hooks/useHandsFree');
    expect(isFiller('Thank you.')).toBe(true);
    expect(isFiller(' you ')).toBe(true);
    expect(isFiller('Open Tom Baker')).toBe(false);
  });
});
