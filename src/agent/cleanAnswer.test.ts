import { describe, expect, it } from 'vitest';
import { cleanAnswer } from './runtime/cleanAnswer';

describe('the answer the user reads', () => {
  it('loses the model talking to itself about its task and its tools, and a label over the result', () => {
    const raw = 'The task was to open the form and fill the two names without saving, and that is done. No further tool call is needed. **Result:** The Add practice member form is open with **First Name: Token** and **Last Name: Bench**. I have not saved it.';
    expect(cleanAnswer(raw)).toBe('The Add practice member form is open with **First Name: Token** and **Last Name: Bench**. I have not saved it.');
  });

  it('keeps everything that says what was done or found — lists and figures too', () => {
    const raw = 'There are **19 stations** in Steiner Wing.\n\n- Steiner Wing: 19\n- Dobson Wing: 19';
    expect(cleanAnswer(raw)).toBe(raw);
    expect(cleanAnswer('Saved. The server accepted the update (200 ok).')).toBe('Saved. The server accepted the update (200 ok).');
  });

  it('never leaves nothing: an answer only about itself stays as it was', () => {
    expect(cleanAnswer('No further tool call is needed.')).toBe('No further tool call is needed.');
  });

  it('drops a sentence that quotes the tool results or an earlier answer of its own', () => {
    expect(cleanAnswer('My earlier answer said it was saved. Hana Whitfield is saved: the page shows "Practice member updated".')).toBe('Hana Whitfield is saved: the page shows "Practice member updated".');
  });
});
