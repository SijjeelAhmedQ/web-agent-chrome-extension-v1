/**
 * What a save the user approved came to — read off its result (the server's answer, the pop-up closing, the page
 * saying so) — and what the agent is told next. A save left without a verdict was saved again “to check” (a patient
 * added twice), or claimed although the server had refused it.
 */

export type SaveVerdict = 'saved' | 'refused' | 'unclear';

export function saveVerdict(output: string): SaveVerdict {
  if (/\bREFUSED\b|\bwas NOT saved\b|\bNOT submitted\b|it was NOT saved|— it was NOT/i.test(output)) return 'refused';
  // The server's yes; or the page saying so (a toast: “Practice member added”); or a new page after the save.
  if (/The server accepted it|successfully|has been (saved|added|created)|(New on the page|The page says|Messages now on the page): [^\n]*\b(added|created|saved|success)/i.test(output)) return 'saved';
  if (/The page changed — now/.test(output)) return 'saved';
  return 'unclear';
}

/** A button that adds a new record (not one that edits or deletes one). */
export const addsRecord = (title: string) => /\b(add|new|create|register|book|save)\b/i.test(title) && !/\b(edit|update|delete|remove|cancel)\b/i.test(title);

/**
 * The request asks for one new record — “add a new practice member”, not “add these three patients” or “add a
 * member for each row”. Several, or a number above one: not one.
 */
export function asksForOne(request: string): boolean {
  const r = request.toLowerCase();
  // Several said in words, or a count of records (“3 patients”, “two members”) — not a number in a value (House No. 12).
  // (Words about records, not values: “fill these fields”, “SMS and Email (both)” are one record.)
  const RECORDS = '(rows?|patients?|members?|practice members?|records?|entries|entry|people|persons?|appointments?|tasks?|users?|names)';
  if (new RegExp(`\\b(each|every|all|several|multiple|these|those|both)\\s+(of\\s+)?(the\\s+|these\\s+)?(new\\s+)?${RECORDS}\\b`).test(r)) return false;
  if (/\b(\d+|two|three|four|five|six|seven|eight|nine|ten|some|many)\s+(new\s+)?(patients|members|practice members|records|entries|people|appointments|tasks|users)\b/.test(r)) return false;
  return /\b(add|new|create|register)\b/.test(r);
}

const DOES = '(save|submit|send|delete|remove|add|create|book|update|confirm|register|press|click|apply|post|publish)';

/** An answer that asks the user whether to go ahead with a save, send or delete — in words: “Should I click Save?” */
export function asksToDo(answer: string): boolean {
  const a = answer.replace(/\*\*/g, '').toLowerCase();
  return new RegExp(`\\b(shall|should|do you want( me)? to|would you like( me)? to|can|may|ok to|okay to)\\s+(i\\s+)?(go ahead and\\s+)?${DOES}\\b[^?]{0,80}\\?`).test(a) || /\b(confirm|approve)\b[^?]{0,60}\b(save|saving|send|sending|delete|deleting)\b[^?]{0,40}\?/.test(a);
}

/** The request itself asks for the save, send or delete (“… and save it”, “send it”, “delete the tag”). */
export function userAskedToDo(request: string): boolean {
  const r = request.toLowerCase();
  if (/\b(don'?t|do not|never|without)\s+(\w+\s+){0,2}(save|submit|send|delete)/.test(r)) return false;
  return /\b(save|submit|send|delete|remove|book|register|publish|post)\b/.test(r);
}

/** Said after an approved save, by its verdict: what was done and what not to do now. */
export function afterSave(verdict: SaveVerdict, workLeft: boolean): string {
  if (verdict === 'refused') return '\nVerdict: NOT saved — the save was refused. Fix what it said, or tell the user what it said; nothing was added.';
  if (verdict === 'saved') {
    return `\nVerdict: SAVED. This is done — don't press its Save again, and don't add it again to check.${workLeft ? ' Go on with what is left of the request.' : ' That was the request: answer the user now, in a sentence or two (what was saved) — no more steps.'}`;
  }
  return '\nVerdict: not clear yet whether it was saved. Look once (read_page: a success message, the pop-up gone, the new record in the list) — don\'t press Save again before you know.';
}
