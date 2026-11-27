# Token use — measured before and after

Phase 2 makes the agent cheaper per task. Each change is measured the same way, so the numbers can be compared.

## How it is measured

- **Benchmark:** [`scripts/token-bench.mjs`](../scripts/token-bench.mjs) runs four fixed tasks on OctansCare dev, each
  starting from the dashboard in a new chat, and reads each task's model calls from the history.
- **Model:** Claude Haiku 5.5 through OpenRouter. The site has its learned knowledge base (31 entries).
- **Per task in the extension:** Configuration → Activity → **Export token report** gives a CSV of the tasks shown
  (calls, tokens in / cached / new / out, cost, seconds, and per call what the prompt was made of).

| # | Task | Kind |
|---|---|---|
| T1 | Open practice members | navigation |
| T2 | Find practice member talha asghar and open their profile | search |
| T3 | Open Stations and tell me how many stations are in Steiner Wing | read and answer |
| T4 | Open the Add practice member form and fill First Name and Last Name (not saved) | form |

*Tokens in* is the whole prompt of every call added up; *cached* is the part the server read from its prompt cache
(billed at a tenth); *new* = in − cached, the part paid in full.

## Baseline — 25 Nov 2026, commit `0468bda` (before Phase 2)

| Task | Calls | Tokens in | Cached | New | Out | Cost | Time |
|---|---|---|---|---|---|---|---|
| T1 | 2 | 33,137 | 6,312 | 26,825 | 95 | $0.0035 | 10 s |
| T2 | 2 | 32,869 | 12,624 | 20,245 | 281 | $0.0028 | 8 s |
| T3 | 6 | 118,705 | 81,108 | 37,597 | 772 | $0.0059 | 16 s |
| T4 | 4 | 70,022 | 37,113 | 32,909 | 346 | $0.0047 | 15 s |
| **Total** | **14** | **254,733** | **137,157 (54%)** | **117,576** | **1,494** | **$0.0168** | |

What one call's prompt was made of (estimated tokens, average):

| System | Knowledge | Tools | Page | Steps so far |
|---|---|---|---|---|
| 2,339 | ~5,270 | 2,944 | 2,700–4,800 | 100–430 |

Seen in the baseline:

- The site's knowledge (~5.3k tokens) goes with **every** call, whatever page the task is on — the largest part.
- T3 is the "simple task, ~100k tokens" case: the table reader failed on the Stations list, so the agent read the
  whole page's text again — 6 calls for one count.
- Only about half of the input came from the cache.

## After each change

Each Phase 2 change adds a row here, measured with the same four tasks.

### Items 8 and 9, first run — 25 Nov 2026

Page reads compacted (a place's controls on one line; another page's side menu, as it was, in short), lists drawn
with divs read as tables (`read_table`, the page's text, each row's controls named by their row), and the site's page
entries only for the page the tab is on (others come with the step that opens them).

| Task | Calls | Tokens in | Cached | Out | Cost | Time |
|---|---|---|---|---|---|---|
| T1 | 2 | 32,957 | 6,312 | 134 | $0.0035 | 10 s |
| T2 | 2 | 31,020 | 12,624 | 355 | $0.0026 | 8 s |
| T3 | **3** (was 6) | **52,197** (was 118,705) | 29,766 | 299 | **$0.0033** (was $0.0059) | 11 s |
| T4 | 4 | 67,188 | 36,992 | 355 | $0.0043 | 15 s |
| **Total** | **11** (was 14) | **183,362** (−28%) | 85,694 | 1,143 | **$0.0136** (−19%) | |

T3 got its answer from the Stations list in one read (20 stations in Steiner Wing). Knowledge per call only fell to
~4,800: two of the seven page entries (Messages, Mentor home) had no `Address:` line, so they still went with every
call. Fixed after this run: an entry's address is also read from its heading (“# Messages page (/messages)”) or from
the navigation entry for that page — per call the knowledge is then 2,700–3,950 tokens (was ~5,250).

### Items 8 and 9, with the address fix — 25 Nov 2026

| Task | Calls | Tokens in | Cached | Out | Cost | Knowledge / call |
|---|---|---|---|---|---|---|
| T1 | 2 | 29,776 | 12,624 | 145 | $0.0023 | 4,017 |
| T2 | 2 | 27,974 | 12,624 | 400 | $0.0022 | 3,238 |
| T3 | 3 | 46,559 | 27,886 | 238 | $0.0027 | 3,396 |
| T4 | 4 | 66,800 | 47,108 | 396 | $0.0031 | 3,530 |
| **Total** | **11** (was 14) | **171,109** (−33%) | **100,242 (59%)** | 1,179 | **$0.0104** (−38%) | ~3,500 (was ~5,270) |

**Accuracy, checked against the page:** Steiner Wing has **19** stations (19 Steiner, 19 Dobson). The baseline said 19
(from the page text, in 6 calls); both runs here said 20 and 21 — the model counted the 38 rows of `read_table` itself
and miscounted. A cheaper answer that is wrong is no saving: `read_table` now ends with the rows counted by each column
of a few values (“Wing: Steiner Wing 19, Dobson Wing 19”, “Status: Free 38”), to be used as they are.
T2 asked which of the three “talha asghar” to open, as in the baseline (right: there are three).

### Items 8 and 9, with the counts — 25 Nov 2026 (items 8 and 9 done)

| Task | Calls | Tokens in | Cached | Out | Cost | Answer |
|---|---|---|---|---|---|---|
| T1 | 2 | 29,744 | 12,624 | 105 | $0.0023 | right |
| T2 | 4 | 60,667 | 43,952 | 550 | $0.0028 | right (asks which of three) |
| T3 | 3 | 46,709 | 27,893 | 304 | $0.0028 | **right: 19** |
| T4 | 4 | 66,853 | 47,131 | 408 | $0.0031 | right (not saved) |
| **Total** | **13** (was 14) | **203,973** (−20%) | **131,600 (65%)** | 1,367 | **$0.0110** (−34%) | 4 of 4 |

T2 took 4 calls this time, not 2: it followed the learned workflow “Find a practice member by name” (open Practice
members, then search there) where it had used the dashboard's own search box. The workflow is right but not the
shortest way; that is the knowledge, not the prompt. Over the last two runs the four tasks cost $0.0104–$0.0110
against $0.0168 before (−34% to −38%).

## Item 10 — the prompt cache in long tasks

A fifth task, long on purpose: *T5 — Open Tags and tell me how many tags are active, then open Stations and tell me
how many stations are in Dobson Wing, then open Messages and tell me how many conversations are unread, then open
Practice members and tell me how many members have no NHI.*

Measured before any change: **8 calls, 172,491 tokens in, only 50,496 (29%) cached, $0.0164** — every call read just
6,312 tokens from the cache, the system prompt. The task's checklist went as an extra message at the end of each call
and was gone from the next one; the cache is marked at the end of a request, so no call ever found the one before it.
Every task with a checklist (every long one) paid in full for all its steps, every call.

Fix 1: the checklist is added to the conversation when it changes, and stays — the conversation only grows at its end.

| Task | Calls | Tokens in | Cached | Out | Cost |
|---|---|---|---|---|---|
| T1 | 2 | 29,761 | 6,312 | 120 | $0.0031 |
| T2 | 2 | 27,268 | 12,624 | 411 | $0.0022 |
| T3 | 3 | 46,677 | 27,885 | 222 | $0.0027 |
| T4 | 4 | 66,773 | 47,085 | 395 | $0.0031 |
| **T5** | **7** (was 8) | **145,520** | **104,197 (72%, was 29%)** | 1,129 | **$0.0068 (was $0.0164, −59%)** |

All answers right (T3: 19; T5: 24 active tags, 19 in Dobson Wing, 0 unread, 62 without NHI).

Fix 2: in T1 the second call still read only the system prompt cached — the first page, put in short once the next
one came, changed the conversation right after the knowledge, and nothing between was marked. The knowledge and the
request now carry a cache mark of their own (Claude: system prompt, that message, and the end — three of the four
marks allowed).

### After both fixes — 25 Nov 2026 (item 10 done)

| Task | Calls | Tokens in | Cached | Out | Cost | Before Phase 2 |
|---|---|---|---|---|---|---|
| T1 | 2 | 29,757 | 17,516 | 185 | $0.0018 | $0.0035 |
| T2 | 2 | 27,265 | 16,064 | 303 | $0.0017 | $0.0028 |
| T3 | 3 | 46,707 | 32,164 | 272 | $0.0023 | $0.0059 |
| T4 | 4 | 66,790 | 50,653 | 373 | $0.0027 | $0.0047 |
| **T1–T4** | **11** (was 14) | **170,519** (was 254,733) | **116,397 (68%, was 54%)** | 1,133 | **$0.0085 (was $0.0168, −49%)** | |
| T5 | 8 | 174,231 | 144,787 (83%) | 1,234 | **$0.0057** | $0.0164 (−65%) |

All five answers right, checked against the pages (T3: 19 in Steiner Wing; T5: 24 active tags, 19 in Dobson Wing,
0 unread, 62 without NHI).

The rest of item 10 was in place already, and stays as it is:

- **Screenshots:** none are sent — the agent works from the page's text.
- **Older steps in short:** once the conversation passes its room (24k tokens on a cloud model), everything before the
  last six steps becomes a line each, at one go and down to 75% of the room, so the cache is broken once and not every
  call. Doing it earlier would not pay now that the cache works: an older step is read at a tenth of the price, and
  putting it in short breaks the cache from there on (the next call writes it all again at 1.25×).

## Item 11 — filling a form

A sixth task, a big form: *T6 — Open the Add practice member form and fill First Name "Token", Last Name "Bench",
Gender "Male", Mobile number "211234567", Email Address "token.bench@example.com", Preferred contact "Email" and City
"Auckland". Do not save it.*

The fields were already set the way React and other frameworks take them (the native value setter, then input,
change and key events). What took the time was around each field: a highlight (220 ms), the form read before and
after it, and a wait for the page to go quiet (0.3–1.5 s) — about 1.4 s a field.

Changes:

- **Fields in a row filled quickly.** fill_form with two fields or more — and two or more type / select_option calls
  in one reply, which the model also sends — fill each field with no highlight and no wait of its own; the form is
  read once before the first and once after the last, and what the page rewrote itself meanwhile is said once. Each
  field is still its own step, with its checks and approvals (a secret field, one already holding the text).
- **A field that holds several (Mantine's pills) is known as one.** OctansCare's Preferred contact (SMS and Email
  chosen) read as an empty text box named “Email”: the model took Email off, put it back, took SMS off — six calls.
  It now reads “Preferred contact — picker that can hold several: SMS, Email”, and select_option leaves an option
  that is chosen already (clicking it again would take it off), saying what else the field holds.

| Task | Calls | Tokens in | Cached | Cost | Time | Per field |
|---|---|---|---|---|---|---|
| T6 before | 12 | 260,649 | 221,810 | $0.0078 | 54 s | ~0.85 s (quick fill only) |
| **T6 after** | **5** | **90,171** | 71,475 | **$0.0035 (−56%)** | **27 s** | ~0.85 s (was ~1.4 s) |
| T4 | 4 | 66,979 | 44,438 | $0.0035 | 17 s | |

## Item 12 — a save, once, and then stop

Tried on a real add and a real edit (a test member, Hana Whitfield, with a valid test NHI, ZHW1374):

- **A modal pop-up keeps the agent in it.** With the “New practice member” drawer open, the agent opened the list
  page's Provider filter behind it for the form's Provider, then pressed Escape (which could have closed the filled
  form). Now the page behind a modal pop-up is left out of page reads (a count says it is there — the drawer's read
  went from 168 controls to 40), and any action on it is refused with the reason.
- **Dropdowns drawn as buttons are in the form's list** (Mantine Select: Provider, Gender, Funding Source) — a
  required Provider was missing from it.
- **A verdict after every approved save:** SAVED (the server accepted it, or the page said so), NOT saved (refused),
  or not clear — and what follows: saved and nothing left, answer now; not clear, look once, don't save again.
  In place of a task_complete tool, whose definition would go with every call.
- **One record asked for, one added:** another add in the same task is refused, whatever its values.
- **One confirmation, not two.** The learned knowledge said “confirm with the user before saving”; the model asked
  in the chat (“Shall I click Save?”), then the approval asked again. A reply that asks in words for what the request
  already asked (“… and save it”) is not shown — the model is told to make the call, and the approval asks. The
  knowledge's heading also says the approval is that confirmation, and the crawler no longer writes it as a question.
- **No double-check after the server said yes** (“PATCH → 200 ok”): it only added a call, and its doubts reached the
  answer.

| Request | Calls | Cost | |
|---|---|---|---|
| Add Hana (Provider not in the list) | 6 | $0.0046 | stopped and asked — right |
| Finish and save (before the fix) | 5 + 3 | $0.0057 | asked “Shall I save?”, then the approval |
| Edit and save (after the fix) | 7 | $0.0033 | the approval only; saved (200 ok) |

T6 filled all seven as asked, did not save, and said Date of Birth (required) was not given. Still slow and left for
later: a click that shows no change is given 3–4 s in case the app answers late (“Unselect “SMS”” took 4.3 s) —
kept for slow apps such as Indici.

## The decision model's tasks — 27 Nov 2026

With the agent's Decision model on (Jev Router picking from Models → Models the decision model picks from), three
tasks were measured, then again after three changes:

- **The writer of an analysis gets what was read, not how the site is worked.** It was sent the site's knowledge
  (4,096 tokens of pages, menus and workflows), the browser rules and every page read: 10,209 tokens for “19”. Now the
  knowledge is cut to what it says about answers, and with a table or records read the page reads go. The decision
  model is also told that a count or a value the data shows needs only the cheapest model.
- **Typed navigation with no model.** “Open stations”, typed as well as said, goes straight to the page the site's
  map knows — what voice already did.
- **No duplicate search when nothing is saved.** “Fill the form, do not save it” searched for the person first,
  closing and reopening the form.

| Task | Before | After |
|---|---|---|
| Open Stations, how many in Steiner Wing (analysis) | 5 calls, $0.011 (writing the answer $0.0087) | 5 calls, **$0.0033** (writing it $0.00025) — right: 19 |
| Open practice members (typed) | 2 calls, $0.0028 | **no call, $0** |
| Add practice member form, fill Token Bench, don't save | 7 calls, $0.0045 | **4 calls, $0.0030** |

The decision model's own pick costs $0.00004–0.00026 a task. With Claude Haiku as the decision model in place of Jev
Router, the Tags count was right (24 active) and the pick cost $0.00004.
