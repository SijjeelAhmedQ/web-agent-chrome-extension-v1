/**
 * Short spoken replies that steer the agent instead of starting a new task. Only whole
 * utterances count — “confirm the booking for Friday” is a request, “confirm” is a reply.
 */
export type VoiceIntent = { kind: 'approve' } | { kind: 'approve-all' } | { kind: 'decline' } | { kind: 'stop' } | { kind: 'request'; text: string };

// Also Roman Urdu / Hindi (“haan kar do”, “nahi”) and what Chrome writes for them in Urdu and Hindi script.
const APPROVE = /^(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|approve|approved|allow|go ahead|do it|save|save it|proceed|haan|han|haa|ji|ji haan|jee|theek hai|thik hai|kar do|kardo|ہاں|جی|جی ہاں|ٹھیک ہے|हाँ|हां|जी|जी हाँ|ठीक है)( it| kar do| ji)?( please)?$/;
const APPROVE_ALL = /^(yes to all|approve all|confirm all|allow all|approve everything|confirm everything)( please)?$/;
const DECLINE = /^(no|nope|cancel|decline|deny|reject|don'?t|do not|skip|skip it|nahi|nahin|nai|na|mat karo|rehne do|نہیں|نہ|नहीं|ना)( it| ji)?( please)?$/;
const STOP = /^(stop|stop it|stop now|stop the agent|stop the task|cancel the task|cancel task|abort|halt)( please)?$/;

export const normalizeSpeech = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”".,!?;:۔।؟]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function parseVoiceCommand(text: string, ctx: { approvalPending: boolean; running: boolean }): VoiceIntent {
  const t = normalizeSpeech(text);
  if (ctx.approvalPending) {
    if (APPROVE_ALL.test(t)) return { kind: 'approve-all' };
    if (APPROVE.test(t)) return { kind: 'approve' };
    if (DECLINE.test(t)) return { kind: 'decline' };
  }
  if (ctx.running && (STOP.test(t) || t === 'cancel')) return { kind: 'stop' };
  return { kind: 'request', text: text.trim() };
}
