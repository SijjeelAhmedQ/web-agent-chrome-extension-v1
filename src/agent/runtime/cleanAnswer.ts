/**
 * The answer as the user should read it: without the model talking to itself about its tools and its task — “No
 * further tool call is needed.”, “The task was to …, and that is done.”, a “Result:” label before the result. Only
 * whole sentences of that kind go; anything that says what was done or found stays. (Working a count out aloud —
 * “plus order 37? No: …” — the prompt asks against; it can't be cut safely, as the figure may be in it.)
 */

/** Sentences that are only about the agent's own working, never about the page or the user's request. */
const ABOUT_ITSELF = [
  /\bno (further|more|other) (tool calls?|tools?|steps?|actions?) (is|are) (needed|required)\b/i,
  /\b(i|I) (don'?t|do not) need (to call|any more|another) (a )?tools?\b/i,
  /^\s*the (task|request) was (to|for)\b[^.]*\b(and )?(that|this|it) (is|has been) (done|complete|completed)\b/i,
  /\b(according to|from|in) (the|my) (tool (result|output|call)s?|instructions|system prompt)\b/i,
  /\bmy (earlier|previous) (answer|reply) (said|says|was)\b/i,
];

/** “**Result:** The form is open” → “The form is open”: a label over the answer itself. */
const LABEL = /^\s*(\*\*(result|answer|final answer|summary):\*\*|(result|answer|final answer|summary):)\s*/i;

export function cleanAnswer(text: string): string {
  if (!text) return text;
  const out = text.split('\n').map((line) => {
    // Sentences of a line, kept with their ending: “… done. No further tool call is needed. **Result:** …”
    const parts = line.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [line];
    const kept = parts.filter((p) => !ABOUT_ITSELF.some((re) => re.test(p.trim())));
    let joined = kept.join('').trimEnd();
    // A label left at the start once the sentences before it are gone (“**Result:**”, “Answer:”).
    return joined.replace(LABEL, '');
  });
  const cleaned = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Never leave the user with nothing: what was cut was all there was.
  return cleaned || text.trim();
}
