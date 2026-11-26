/**
 * Spoken feedback with Chrome's own voices (speechSynthesis): the approval question, then what was done. A new
 * sentence cuts off the one still playing, so the user never hears a stale one.
 */
/**
 * Who wants to know while something is said aloud: an open microphone (hands-free) pauses, so it doesn't write
 * down the extension's own voice as a command (“… Say yes or no.” sent back as a request).
 */
const listeners = new Set<(speaking: boolean) => void>();
let speaking = 0;
export function onSpeaking(fn: (speaking: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const setSpeaking = (on: boolean) => {
  speaking = Math.max(0, speaking + (on ? 1 : -1));
  listeners.forEach((fn) => fn(speaking > 0));
};

export function say(text: string, lang = 'en-US'): Promise<void> {
  const synth = globalThis.speechSynthesis;
  if (!synth || !text.trim() || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve();
  synth.cancel();
  setSpeaking(true);
  return new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.startsWith(lang.split('-')[0]));
    if (voice) u.voice = voice;
    u.rate = 1.05;
    // Chrome sometimes never fires `end` (a voice still loading): don't wait on it for ever.
    const timer = setTimeout(resolve, 1500 + text.length * 90);
    u.onend = u.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    synth.speak(u);
  }).then(() =>
    // A moment for the speaker's last sound to die away before the microphone listens again.
    new Promise<void>((done) =>
      setTimeout(() => {
        setSpeaking(false);
        done();
      }, 250),
    ),
  );
}

export const stopSaying = () => globalThis.speechSynthesis?.cancel();

/** An approval as a question to say aloud: “Click “Save”? Say yes or no.” */
export function approvalQuestion(prompt: { title: string; confirmLabel: string; choices?: { id: number; label: string }[]; target?: number; ask?: unknown }): string {
  // The agent's own question (ask_user): said as it is — the answer is a value, not yes or no.
  if (prompt.ask) return prompt.title.trim();
  // A form's buttons to pick from: yes presses the one the agent meant.
  const meant = prompt.choices?.find((c) => c.id === prompt.target)?.label;
  if (meant) return `Press ${spoken(meant)}? Say yes or no.`;
  const title = prompt.title.trim().replace(/[.?!]+$/, '');
  // “Click “Deactivate (never deleted — Tag §1)” — row 5 “Test User · Yellow Flag · Pinned”” → “Deactivate Test User”.
  const button = title.match(/^click\s+“([^”]+)”/i)?.[1];
  const row = title.match(/row \d+ “([^”·]+)/i)?.[1];
  if (button) return `${spoken(button)}${row ? ` ${spoken(row)}` : ''}? Say yes or no.`;
  return `${spoken(title) || prompt.confirmLabel}? Say yes or no.`;
}

/** What reads well aloud: no notes in brackets, no symbols. */
function spoken(text: string): string {
  return text
    .replace(/\([^)]*\)/g, '')
    .replace(/[“”"§·|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
