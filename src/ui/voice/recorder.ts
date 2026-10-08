import { SAMPLE_RATE } from '@/shared/voice/speech';

/**
 * Records the microphone as 16 kHz mono 16-bit PCM — the format the speech server expects.
 * The AudioContext runs at 16 kHz, so the browser resamples; no extra work here.
 */
export class PcmRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Int16Array[] = [];

  constructor(private readonly onLevel?: (level: number) => void) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but needs no separate worklet module (extension CSP keeps this simple).
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const out = new Int16Array(input.length);
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        sum += s * s;
      }
      this.chunks.push(out);
      this.onLevel?.(Math.min(1, Math.sqrt(sum / input.length) * 4));
    };
    source.connect(this.node);
    this.node.connect(this.ctx.destination); // the output buffer stays silent
  }

  /** Seconds recorded so far. */
  get seconds(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0) / SAMPLE_RATE;
  }

  async stop(): Promise<Int16Array> {
    this.release();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Int16Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];
    return pcm;
  }

  cancel(): void {
    this.release();
    this.chunks = [];
  }

  private release() {
    if (this.node) {
      this.node.onaudioprocess = null;
      this.node.disconnect();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }
}

export type MicPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

export async function micPermission(): Promise<MicPermission> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state as MicPermission;
  } catch {
    return 'unknown';
  }
}
