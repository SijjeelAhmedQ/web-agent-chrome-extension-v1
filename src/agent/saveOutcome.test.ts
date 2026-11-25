import { describe, expect, it } from 'vitest';
import { addsRecord, afterSave, asksForOne, asksToDo, saveVerdict, userAskedToDo } from './runtime/saveOutcome';

const HANA =
  'Add a new practice member and save it. Open the Add practice member form and fill these fields: First Name "Hana", Date of Birth "14/03/1988", Mobile number "21 555 0142", Preferred contact "SMS" and "Email" (both), NHI Number "ZHW1374", House No. "12", Postal Code "1011". Then save it and check it was saved.';

describe('a save the user approved', () => {
  it('is read as saved, refused or not clear — from the server, the pop-up, the page', () => {
    expect(saveVerdict('Clicked "Save". The pop-up “New practice member” closed. The server accepted it: POST /api/patients → 201 ok')).toBe('saved');
    expect(saveVerdict('Clicked "Save". The server REFUSED it — nothing was saved by it. POST /api/patients → 409 refused: NHI already exists')).toBe('refused');
    expect(saveVerdict('Clicked "Save", but the form is still there and nothing changed — it was NOT saved.')).toBe('refused');
    expect(saveVerdict('Clicked "Save". New on the page: “Practice member added”. The page may have updated.')).toBe('saved');
    expect(saveVerdict('Clicked "Save". The page may have updated; call read_page if you need to see the result.')).toBe('unclear');
  });

  it('says what to do next: saved and nothing left — answer now; refused — nothing was added', () => {
    expect(afterSave('saved', false)).toMatch(/SAVED.*don't press its Save again.*answer the user now/s);
    expect(afterSave('saved', true)).toMatch(/Go on with what is left/);
    expect(afterSave('refused', false)).toMatch(/NOT saved/);
    expect(afterSave('unclear', false)).toMatch(/don't press Save again before you know/);
  });
});

describe('a request for one new record', () => {
  it('is one — whatever numbers, “these fields” or “both” its values have', () => {
    expect(asksForOne(HANA)).toBe(true);
    expect(asksForOne('Add a new patient called Arya Stark')).toBe(true);
  });

  it('is not several, nor a count above one, nor one that adds nothing', () => {
    expect(asksForOne('Add these three patients: A, B and C')).toBe(false);
    expect(asksForOne('Add 3 practice members from the list')).toBe(false);
    expect(asksForOne('Add a tag to each of the members')).toBe(false);
    expect(asksForOne('Open practice members')).toBe(false);
  });

  it('a button that adds, not one that edits or deletes', () => {
    expect(addsRecord('Save this form?')).toBe(true);
    expect(addsRecord('Add practice member?')).toBe(true);
    expect(addsRecord('Update practice member?')).toBe(false);
    expect(addsRecord('Delete this record?')).toBe(false);
  });
});

describe('asking in the chat what the user asked for', () => {
  it('is caught: “Should I click Save?” after “… and save it”', () => {
    expect(asksToDo('Floor / Building now reads "Unit 4".\n\nShould I click **Save** to store this change?')).toBe(true);
    expect(asksToDo('It has not been saved yet. Shall I click **Save** on the Hana Whitfield form?')).toBe(true);
    expect(userAskedToDo('Open Hana Whitfield\'s edit form, change Floor / Building to "Unit 4" and save it.')).toBe(true);
  });

  it('not a question for a value, nor a request that says not to save', () => {
    expect(asksToDo('Which provider should I choose? The list has Todd Keenan and Mary Becerra.')).toBe(false);
    expect(asksToDo('The form is saved.')).toBe(false);
    expect(userAskedToDo('Fill First Name "Token". Do not save it.')).toBe(false);
    expect(userAskedToDo('Open practice members')).toBe(false);
  });
});
