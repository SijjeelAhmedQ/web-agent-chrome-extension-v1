# Testing the Web Agent

Four ways, from the simplest:

| Way | What it checks | Needs |
|---|---|---|
| 1. By hand in Chrome | The real extension, the way a user works | Chrome, a model (Kaggle or OpenRouter) |
| 2. Unit tests | The agent's logic: compaction, checklist, risk rules, parsing… | Node only |
| 3. Mock e2e suites | The extension on mock pages with a scripted model | Node, Puppeteer |
| 4. Live runner | The real agent on the Indici training site, unattended | Node, Puppeteer, a model, an Indici login |

## 1. By hand in Chrome

1. Build: `npm install`, then `npm run build`. This creates `dist/`.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `dist` folder.
   After every new build, press the extension's ⟳ reload button.
3. Open the extension's **Options** page, go to **Advanced → Configuration → Import**, and choose
   `knowledge/web-agent-restore-indici.json`. This loads the Indici agent, its tools and its knowledge.
   Import replaces the current setup, so do it before step 4.
4. Go to **Models** and add a connection:
   - **Kaggle GPU**: the notebook prints a Server address and a Notebook key. Paste both, choose the model
     `qwen3.8:27b-q4_K_M`, and set **Context window** to the number the notebook prints (65536 for
     `web_agent_qwen38long`).
   - **OpenRouter** (paid, faster): your key. Its list offers `google/gemini-3.8-flash`, `anthropic/claude-haiku-5.5`
     and `typesafe/jev-router`. **Thinking** (on every connection): Off, Low or High — Low suits Flash and Haiku.
6. Optional, on the agent (Agents → the agent → Model): switch the **Decision model** on (Jev Router by default, or
   any OpenRouter model). For each task it picks the model that does it — the cheapest that will do it right — from
   **Models → Models the decision model picks from**, a list you edit: add any OpenRouter model, with a note on what
   it is good for; its price and tool support come from OpenRouter. UI clicks (go to, open, search) go to the
   cheapest on the list without asking it; data analysis: the cheapest reads and the picked one writes it; a model that
   gets stuck: it picks another to carry on. The activity shows "Chose DeepSeek Flash · Jev Router"; the side panel
   bar says "Jev Router picks". You still approve every save, delete and complete. A pick costs about $0.0001.

A stopped or failed task shows **Resume**: it carries on from where it stopped. A finished task shows **Run again**.
5. Log in to https://pmstraining.vitonta.com, open the extension's side panel and type a request.

Requests that have been tried (patient Arya STARK):

```text
goto patients and select arya stark

go to patients, select Arya Stark, then do these one after another: (1) add a medication: paracetamol 500 mg
tablet, take 1, frequency TDS, duration 3 days, repeats 1, directions "Take 1 tablet three times daily for pain",
private to pharmacist "[web agent test]" — save it; (2) add a task: subject "[web agent test] review bloods", due
next week — save it; (3) add a recall: provider Training DOCTOR, recall group Bloods, description CBC, note
"[web agent test] recall", recall in 6 months — save it; (4) add the diagnosis Essential hypertension: status
Probable, onset date 01/10/2026, summary "[web agent test]" — save it

list Arya's medications prescribed today — name, directions, quantity
show Arya's active tasks — subject and due date
list all of Arya's recalls, active and completed, with description, due date, priority and provider
list Arya's diagnoses: the long term ones and the problem list
edit Arya's task "[web agent test] review bloods": change the priority to Medium
delete the paracetamol 500 mg tablet prescribed for Arya today — only that one
complete Arya's task "[web agent test] review bloods"
review Aqib's inbox results
```

What to look for:

- **Every save, delete or complete asks you first.** Read the values on the card before you press Save.
  If a value is wrong, press Cancel. The form on the page is cancelled too.
- The agent stops and asks when Indici asks something: the NZF interactions pop-up, "this medicine is already
  in the active list", or "a recall of this group already exists". Answer in the chat; it carries on.
- A task cannot be deleted in Indici, only completed. A recall's "delete" is its Inactive icon.
- Tag what you add with "[web agent test]" so it is easy to find and remove.

## 2. Unit tests and types

```bash
npm test
npm run typecheck   # not `tsc --noEmit -p .` — the root tsconfig only points at the others, so that checks nothing
```

## 3. Mock e2e suites (`tests/e2e-mocks/`)

```bash
cd tests/e2e-mocks
npm install
node server.mjs                      # mock site on port 4599, scripted model on port 4600 — leave it running
node formbuttons-e2e.mjs ../../dist  # in a second terminal; each *-e2e.mjs prints PASS/FAIL per check
```

The mock model answers by the first words of each request ("records status", "form save", "task form"…).
`resume-e2e.mjs` checks Resume. `openrouter-smoke.mjs ../../dist` runs real models on OpenRouter on the mock Add Task
page (`WORKER`, `DECIDER`, `THINKING` choose them) and prints which model took each step and what it cost.

## 4. Live runner (`tests/live-indici/`)

The real agent and a real model on the Indici training site, with Puppeteer playing the user. Everything it writes
is saved for real, so run it only on test patients, and keep `APPROVE` narrow.

### Once

```bash
cd tests/live-indici
npm install
```

Keys are read from files at run time and never printed:

```text
C:/Users/92313/.webagent-kaggle.env       KAGGLE_URL=https://….trycloudflare.com
                                          KAGGLE_KEY=<the notebook key>
C:/Users/92313/.webagent-openrouter.env   OPENROUTER_KEY=<your OpenRouter key>
```

### Each session

```bash
npm run build                                      # at the repo root, after code changes
node indici-browser.mjs C:/Users/92313/.webagent-ext   # opens Chrome with the extension — log in by hand there
```

Leave that terminal open; the window lives as long as it runs. In a second terminal:

```bash
node live-reinstall.mjs   # after a new build: puts the new dist into the open window; the login stays
node live-keeper.mjs      # keeps a blank tab, so closing Indici tabs never closes the window
```

Then open the patient (or let the agent do it) and run requests:

```bash
PROVIDER=kaggle CTX=65536 REQUEST_MINUTES=150 \
APPROVE='^(?!.*(Delete|Inactive|Click to cancel|Click “Complete)).*' \
APPROVE_IF='[["Strength 500 mg", "Take 1 Frequency TDS"], ["Recall Group", "Recall Group Bloods Description CBC"]]' \
REQUESTS='["go to patients, select Arya Stark, then … (the serial request above)"]' \
node live-agent.mjs
```

When the agent stops with a question, answer it in the same chat:

```bash
KEEP_CHAT=1 PROVIDER=kaggle CTX=65536 APPROVE='…' REQUESTS='["OK"]' node live-agent.mjs
```

On Windows, run these commands in Git Bash: the `NAME=value command` form does not work in PowerShell or cmd.

| Setting | Meaning |
|---|---|
| `REQUESTS` | JSON list of requests, sent one after another in one chat |
| `PROVIDER=kaggle` | Use the Kaggle notebook. Without it, the runner uses DeepSeek on OpenRouter |
| `CTX` | The Kaggle notebook's context window (16384, or 65536 for the long notebook) |
| `MODEL` | Another model name than the default |
| `APPROVE` | Regex. An approval card is approved only when its text matches. Anything else is declined |
| `APPROVE_IF` | `[[cardRegex, mustHaveRegex], …]`: a card that matches `cardRegex` but lacks `mustHaveRegex` is declined, as a careful user would |
| `APPROVE_BUTTON` | On a form's button card (Save / Complete / Reset / Cancel), the button that counts as yes. Default `Save`; several with `|`, e.g. `Save task|Save` |
| `SITE` | Regex for the tab to work on when several are open, e.g. `pmstraining` or `inbox-app`. Default: the last vitonta tab |
| `KEEP_CHAT=1` | Continue the last chat, for answering the agent's question |
| `ANSWERS` | `[[questionRegex, answer], …]`: when the agent stops with a question that matches, the answer is sent in the same chat — a whole flow with its questions in one run |
| `PANEL=side` | Drive the extension's real side panel beside the site (open it with the toolbar icon, or `node live-open-panel.mjs`) instead of a tab of its own |
| `MAX_STEPS` | Raise the agent's step limit (e.g. 120 for the serial flow) |
| `REQUEST_MINUTES` | How long to wait for one request (default 20) |
| `NO_ANSWER=1` | Only show the first approval card, then stop |

The output goes to the terminal. The run log is written to `tests/indici-live/agent-run.log`. Every model call is
written to `tests/indici-live/model-calls.json`. Screenshots go to `tests/indici-live/captures/`. That folder is not
committed, because it holds patient data.

### Look at the live page without the agent

| Script | What it does |
|---|---|
| `live-table.mjs "<heading or text>"` | Reads a list on the page (e.g. `"Long Term Diagnosis"`) |
| `live-grep.mjs "<regex>"` | Every line of page text that matches |
| `live-find.mjs "<regex>"` | Visible elements whose text or title matches |
| `live-findq.mjs "<words>"` | The agent's `find_element` on the live page |
| `live-formaround.mjs` | For each Save button: the required fields still empty, and the fields marked wrong |
| `live-section.mjs Medications "<near>"` | Opens a consult section from the left sidebar and reads its list |
| `live-press.mjs "<name>" "<context>"` | Presses one control by its exact name. It saves nothing by itself, but it really clicks |
| `live-shot.mjs out.png` | A screenshot of the Indici tab |
| `live-close-panels.mjs` | Closes side-panel tabs left open by a stopped run. The agent in them stops |
| `live-close-extra.mjs` | Closes all Indici tabs but the first |
| `live-cancel-med.mjs go` | Cancels an open, unsaved medication form |
| `live-open-panel.mjs` | Opens the Web Agent side panel beside the Indici tab (after a reinstall closed it) |

The Smart AI Inbox has its own tab. Start these with `TAB=inbox-app` so they work there:

| Script | What it does |
|---|---|
| `live-elements.mjs [max]` | The elements the agent's content script lists on the tab |
| `live-area.mjs "Go to Consult" Next` | The record showing, as `read_records` reads it: its table rows and its entry in the list (red or not) |
| `live-colours.mjs` | The record's table and the list's record buttons, with their colours |
| `live-recordwalk.mjs "Arya STARK. Abnormal" 6` | Opens a patient and goes through its records with Next. The app marks them read |
| `live-selects.mjs "Status (All)"` | Opens each matching dropdown with a real click and prints its options |
| `live-explore.mjs "<name>" …` | Opens each named control, prints what appeared, then presses Escape. Never give it a control that saves or files |
| `live-actionforms.mjs Actions "Create Task"` | Opens a menu item's pop-up, prints its form fields, then cancels it. Nothing is saved |
| `live-close-inbox.mjs` | Closes the Smart Inbox tabs, to try "open smart inbox" from Indici again |
| `live-antselect.mjs "Create Recall" "Recall Group=Bloods" …` | Opens an Actions form, chooses each Ant Design dropdown with `select_option`, prints what the Save's approval card would show, then closes it. Nothing is saved |
| `live-aicards.mjs "Aqib" "Add recall" "Add diagnosis"` | Opens a patient's AI cards: each card's quick edit and its Full Form, printed, then cancelled. Nothing is created |
| `live-aifullform.mjs "Serial FBCs" "Add recall" "Description=CBC" "Notes~text"` | An AI card's Full Form as the agent fills it (`=` chooses, `~` types), and what its Save card would show; then closed |
| `live-aidiagsave.mjs "Dyslipidaemia" "[web agent test] …"` | **Saves** an AI diagnosis through its Full Form and prints the page's messages for 20 s (the app answers “Something went wrong” when the Concept ID is `<UNKNOWN>`) |
| `live-close-dialogs.mjs` | Closes pop-ups left open on the tab with their Close / Cancel / × (nothing saved) |
| `live-panel-state.mjs` | The side panel now: the approval card waiting, if any, and the end of the last turn |
| `live-panel-answer.mjs yes|no` | Answers the approval card waiting in the side panel (after a runner stopped) |
| `live-addinbox.mjs` (`TAB=pmstraining`) | Opens Indici's "Add to Patient Inbox" pop-up, prints its fields and dropdowns, then cancels it |

Example: `PANEL=side MODEL=google/gemini-3.8-flash REQUESTS='["summarize all abnormal inbox records"]' node live-agent.mjs` runs the agent on the inbox tab (open it first).

### The whole suite in one command

`bash run-suite.sh` (in `tests/live-indici`, Git Bash) runs, in the side panel, one chat each: cleanup of earlier test
diagnoses and a recall, then each add alone (medication, task, recall, diagnosis), then all four in one request. The
agent's questions are answered as a user would (`ANSWERS`). Each run's log is in `tests/indici-live/suite/`. It
takes about 1.5 hours on Qwen3.8 27B (64k). Change the requests and labels in the script before running it again.

### The serial flow, start to finish

The transcript of a passing run is in `transcripts/serial-flow-qwen38-64k-2026-10-22.txt`. It took about 28 minutes
on Qwen3.8 27B with 64k context. The agent asked twice: OK on the NZF pop-up, and "Yes - Add new" when a CBC
recall already existed. On the 16k notebook the same flow failed: the agent lost its steps as old messages were cut.
