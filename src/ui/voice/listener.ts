import { SAMPLE_RATE } from '@/shared/voice/speech';

/**
 * Hands-free listening: the microphone stays open and a small voice-activity detector splits
 * the stream into utterances. Speech starts when the level rises clearly above the room's
 * background noise; it ends after a pause. While someone speaks, the audio so far is offered
 * for live text; at the pause, the whole utterance is handed over as one command.
 */

const FRAME = 1024; // 64 ms at 16 kHz
const FRAME_MS = (FRAME / SAMPLE_RATE) * 1000;
const PRE_ROLL_FRAMES = 5; // ~320 ms kept from before speech starts, so first syllables aren't lost
const START_FRAMES = 3; // ~190 ms above threshold to count as speech
const MIN_SPEECH_MS = 350; // shorter bursts are clicks and coughs
const MAX_UTTERANCE_MS = 30_000;
const MIN_THRESHOLD = 0.012;

export interface ListenerEvents {
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
  /** Audio of the current utterance so far, every `partialEveryMs` while speaking. */
  onPartial?: (pcm: Int16Array) => void;
  /** A complete utterance, after the pause. */
  onUtterance?: (pcm: Int16Array) => void;
  /** Speech too short to be a command. */
  onDiscard?: () => void;
}

export interface ListenerOptions {
  pauseMs: number;
  partialEveryMs: number;
}

const concat = (chunks: Int16Array[]) => {
  const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
};

export class ContinuousListener {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private preRoll: Int16Array[] = [];
  private speech: Int16Array[] = [];
  private speaking = false;
  private loudFrames = 0;
  private quietMs = 0;
  private speechMs = 0;
  private sincePartialMs = 0;
  private noiseFloor = 0.004;
  private paused = false;

  constructor(
    private readonly events: ListenerEvents,
    private readonly options: ListenerOptions,
  ) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(FRAME, 1, 1);
    this.node.onaudioprocess = (e) => this.frame(e.inputBuffer.getChannelData(0));
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  /** Stop listening (e.g. while a command is being transcribed is NOT needed — this is for muting). */
  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.reset();
  }

  stop(): void {
    if (this.node) {
      this.node.onaudioprocess = null;
      this.node.disconnect();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.node = null;
    this.stream = null;
    this.ctx = null;
    this.reset();
  }

  private reset() {
    this.speaking = false;
    this.speech = [];
    this.loudFrames = 0;
    this.quietMs = 0;
    this.speechMs = 0;
    this.sincePartialMs = 0;
  }

  private frame(input: Float32Array) {
    const pcm = new Int16Array(input.length);
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / input.length);
    this.events.onLevel?.(Math.min(1, rms * 6));
    if (this.paused) return;

    const threshold = Math.max(MIN_THRESHOLD, this.noiseFloor * 3);
    const loud = rms > threshold;

    if (!this.speaking) {
      // Learn the room's background level from quiet frames.
      if (!loud) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
      this.preRoll.push(pcm);
      if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
      this.loudFrames = loud ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= START_FRAMES) {
        this.speaking = true;
        this.speech = [...this.preRoll];
        this.preRoll = [];
        this.speechMs = this.loudFrames * FRAME_MS;
        this.quietMs = 0;
        this.sincePartialMs = 0;
        this.events.onSpeechStart?.();
      }
      return;
    }

    this.speech.push(pcm);
    this.speechMs += FRAME_MS;
    this.sincePartialMs += FRAME_MS;
    // Falling below a slightly lower bar counts as quiet, so trailing syllables stay in.
    this.quietMs = rms < threshold * 0.7 ? this.quietMs + FRAME_MS : 0;

    if (this.quietMs >= this.options.pauseMs || this.speechMs >= MAX_UTTERANCE_MS) {
      const voiced = this.speechMs - this.quietMs;
      const audio = concat(this.speech);
      this.reset();
      if (voiced < MIN_SPEECH_MS) this.events.onDiscard?.();
      else this.events.onUtterance?.(audio);
      return;
    }
    if (this.sincePartialMs >= this.options.partialEveryMs) {
      this.sincePartialMs = 0;
      this.events.onPartial?.(concat(this.speech));
    }
  }
}
