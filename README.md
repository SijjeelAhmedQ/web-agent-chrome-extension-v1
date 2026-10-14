# Web Agent — a universal AI agent for Chrome

A Chrome side-panel agent that reads and works any website for you: search, fill in forms, click through multi-step flows, read tables and summarize pages. It works on ordinary sites (Google, GitHub, shops, CRMs, dashboards) and on our own CareFlow PMS, and contains no code written for any particular site.

> “I tell it what I want, and it handles the website.”

**Stack:** React 18 · TypeScript · Vite 6 · Ant Design 5 · Redux Toolkit · Zod · lucide-react · Chrome Manifest V3 (side panel, content script, service worker). This is the same stack as CareFlow.

---

## Features

| | |
|---|---|
| **Side panel** | Chat with the agent next to any page. It knows which page you're on, shows a live step-by-step activity timeline, and has a prominent **Stop** button (also `Esc`). |
| **Running on** | A bar under the panel header shows what powers the agent and where it runs: the actions model (e.g. *Qwen 3.5 9B · Kaggle*) and the voice engine (e.g. *Whisper turbo v3 · Kaggle*), each with a live status dot. Click it to see details: *This computer · Ollama* or *Kaggle GPU · hosted* with the tunnel address, the GPU, and whether the model is loaded. On first run, the panel finds Ollama on this computer and connects it in one click. |
| **Generic browser tools** | `read_page`, `find_element`, `click`, `hover`, `open_menu`, `type`, `clear`, `select_option`, `scroll`, `press_key`, `wait`, `navigate`, `go_back`, `go_forward`, `list_tabs`, `open_tab`, `switch_tab`, `close_tab` |
| **Hover and nested menus** | `hover` opens menus that appear on mouse-over and returns what appeared. `open_menu(["Products", "Laptops"])` opens nested menus level by level. Both work for JavaScript menus (mouse events) and for CSS-only `:hover` menus: the page's `:hover` rules are copied onto a class and applied to the hovered element, because scripts can't set `:hover`. `open_menu` never clicks the final item, so that click goes through `click` and its approvals. |
| **Page understanding** | A compact, semantic view of the page: interactive elements with stable ids, accessible names, values, states, table-row and dialog context, headings and visible text. The model never receives raw HTML. Open shadow roots and same-origin iframes are included. |
| **Multiple agents** | Each agent has its own name, look, instructions, model, tools, skills, step limit and approval policy. Switch between them from the panel header. |
| **Teams (multi-agent)** | A team agent splits a request between specialist agents, for example Medication, Diagnosis, Task, Recall and Appointment, and they work **at the same time**, each in its own tab. Their model calls overlap; clicks and typing take quick turns in front. Each member has its own live activity and approvals in the side panel, plus *Approve all*. The **CareFlow team** template sets up all of it in one click. |
| **Skills** | Reusable instructions, either *always on* or *loaded when relevant* (the agent calls `load_skill`). A skill can be limited to certain sites, for example `localhost:5173` for CareFlow. |
| **Custom tools** | Connect agents to your own HTTP endpoints (GET/POST, headers, typed parameters, optional approval). |
| **Models** | Ollama (native API, with a configurable context window), the CareFlow bridge, the **Kaggle GPU notebook** (Qwen 3.5 9B, Ternary Bonsai 2 27B, MedGemma 4B), OpenRouter, OpenAI, Anthropic, LM Studio, llama.cpp, vLLM, or any OpenAI-compatible server. You can test a connection and load its list of models. Models that can't call tools (MedGemma) still work: the agent reads the page and answers. |
| **Voice input** | **Hands-free (default):** click the microphone once and it keeps listening. Your words appear live while you speak, and each pause (1 s by default) sends what you said as a command, with no more clicks. Say **“confirm”** or **“cancel”** to answer an approval, **“approve all”** for several, and **“stop”** to stop the agent. Commands spoken while the agent is busy queue up and run in order. **Push to talk** is also available. Speech is transcribed on the Kaggle GPU by **Whisper large-v3 turbo** (with your vocabulary for names and terms) or **Omi Med STT v1**. |
| **Double-check before answering** | When the agent says it selected, saved, added or scheduled something, it first re-reads the page and checks that claim. If the page doesn't confirm it, the agent does the work for real (search, next page, click) or says it didn't happen, so made-up results never reach you. On by default; per agent under Agents → Model. |
| **Safety** | Asks before purchases, sending, deleting, submitting forms and entering passwords. Sites can be blocked or made read-only, and text on pages is treated as data, not instructions. |
| **Activity** | Every task's request, site, status, steps, timing and result, with search and filters. |
| **Configuration page** | Agents · Skills · Tools · Models · Voice · General · Appearance · Agent behavior · Permissions · Privacy · Advanced (developer view, page-reading limits, import/export, reset) · Activity. |
| **Design** | Light and dark themes with an emerald accent on slate neutrals (taken from codeiyo.com), Inter and JetBrains Mono, keyboard-friendly, reduced-motion aware. |

---

## Install (development)

```bash
npm install
npm run build          # typecheck + build into dist/
```

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. The configuration page opens automatically. Go to **Models** and connect a model.
4. Click the toolbar icon (or press `Alt+Shift+A`) to open the side panel.

`npm run dev` rebuilds on change. After a rebuild, click ↻ on the extension card.

### Connecting a model

| Where the model runs | Preset | Notes |
|---|---|---|
| Ollama on this PC | **Ollama** | `http://localhost:11434`, `qwen3.5:4b`. Uses the native API so the **context window** can be set (default 12,288 tokens, the same as CareFlow, so the model doesn't reload). **Skip thinking** is on for speed. |
| CareFlow bridge | **CareFlow bridge** | `http://127.0.0.1:8765/ollama`. For its vLLM or OpenRouter routes, use *Other (OpenAI-compatible)* with `/vllm/v1` or `/openrouter/api/v1`. |
| Kaggle GPU (free T4) | **Kaggle GPU** | Run [`kaggle/careflow_kaggle.ipynb`](kaggle/careflow_kaggle.ipynb) and paste the address and key it prints (`/vllm/v1` is added for you). Pick a model: **Qwen 3.5 9B** (best default for actions), **Ternary Bonsai 2 27B** (strongest; needs GPU T4 ×2), or **MedGemma 4B** (medical knowledge; answers only, can't click or type). The key is sent as `X-CareFlow-Key`. Saving this connection also sets up Voice. |
| Cloud | OpenRouter / OpenAI / Anthropic | Paste an API key. Keys stay in this browser. |
| Other local servers | LM Studio / llama.cpp / vLLM | The server must support tool calling (llama.cpp needs `--jinja`; vLLM needs `--enable-auto-tool-choice`). |

Local servers usually reject requests coming from a `chrome-extension://` origin. The service worker installs a `declarativeNetRequest` rule that removes the `Origin` header from **this extension's own** requests to `localhost`, `127.0.0.1` and `0.0.0.0`, so Ollama needs no `OLLAMA_ORIGINS` setup.

### Site base: knowledge per website

Configuration has two levels:
- **Extension base:** Agents, Skills, Tools, Models and Voice. Used on every site.
- **Site base (Sites):** one setup per website. It switches on by itself when the agent's tab is on one of the site's addresses, and adds to the agent's own setup.

Each site has:
- **Knowledge base:** what you teach the agent about the site. There are four kinds:
  - *Rule:* "open a patient by clicking the name, never an icon".
  - *Navigation:* menus and addresses.
  - *Page & controls:* what columns, icons and buttons mean.
  - *Workflow:* an example request with its steps.

  Rules, navigation and page notes always go into the prompt. Everything goes in full while it fits, with workflows that match the request first. If the knowledge base outgrows the space, the rest is listed by title and the agent reads it with the `site_knowledge` tool.
- **Agents:** choose which agents work on the site. The first one opens by itself in the side panel when you arrive there. Choosing an agent switches its skills and tools on for the site, and you can turn any of them off just for this site.
- **Skills and custom tools:** every agent gets them, but only on this site. *Remove all* clears the site's list; the skills and tools themselves stay in the Extension base.
- **Built-in tools:** switch them off one by one, or use *All on* / *All off*. If *Read page* is off, a warning offers to turn reading back on, because without it the agent can't see the site.
- **Model:** run every agent on this site with a given connection or model.
- **Preview:** shows exactly what an agent gets for a sample request.

The side panel's status bar shows a chip, such as **Indici**, while a site setup is in use.

**Sites → From a template** has two ready-made setups:
- **Indici:** you add your practice's address. It covers hover menus, the Patient Search page, opening a patient by name, and the "select a patient from Search & List" workflow.
- **CareFlow:** for the local CareFlow app.

Everything is ordinary configuration: you can edit or delete it, and it is included in Export and Import.

### Teams: agents working at the same time

**Agents → New agent → CareFlow team** creates:
- Five specialists: Medication, Diagnosis, Task, Recall and Appointment agents. Each knows only its own CareFlow form.
- A **CareFlow PMS** skill limited to `localhost:5173`, with navigation, dropdowns and the date and time formats.
- The **CareFlow team** coordinator, set to run every member at once (up to 5). If a Kaggle connection exists, all six use it.

Pick **CareFlow team** in the side panel and send one request. For example:

> Go to patients, select Tom Baker and add medication Metformin, Panadol, Gabapentin, Rituximab 500 mg twice daily for 30 days, add hypertension as a diagnosis, create a task for blood pressure monitoring, recall the patient for neck pain after two weeks, and schedule a follow-up appointment next Tuesday at 3 pm.

How it runs:
1. The coordinator's model splits the request into one self-contained task per member. Relative dates are written out exactly, e.g. "Tuesday, Oct 13, 2026 at 3:00 PM". Every prompt includes the next 14 days, so small models get them right.
2. Each member opens its own tab, in a tab group, and does its part.
3. Model calls run in parallel. Browser actions take turns with their tab in front, because Chrome freezes animations in background tabs and AntD dialogs and dropdowns depend on them.
4. When all members finish, their tabs close, your page reloads to show the new records, and the panel shows a summary.

Configure any team under **Agents → (agent) → Team**: members, *Run members at the same time*, *Parallel limit* and *Tidy up when done*. Set the parallel limit to what the model server can answer at once:

| Model server | Parallel limit |
|---|---|
| Kaggle notebook, T4 ×2 | 5 (its `OLLAMA_NUM_PARALLEL`) |
| Kaggle notebook, one T4 | 2 |
| Local Ollama on a small GPU | 1–2 |

With *Ask before important actions*, every Save asks for approval. *Approve all* clears several at once. For a trusted, repetitive workflow you can switch the specialists to *Don't ask*.

Teams are safe for CareFlow because each record type has its own storage (`careflow.medications`, `careflow.diagnoses`, …). Give each record type to only one member, so two tabs never write the same list.

### Kaggle notebook (models and voice)

The [`kaggle/`](kaggle/) folder holds the CareFlow GPU notebook. `careflow_gpu_server.py` is the server, `make_notebook.py` rebuilds the notebook from it, and `careflow_kaggle.ipynb` is the notebook to import into Kaggle.

1. On Kaggle: **File → Import Notebook** → `careflow_kaggle.ipynb`. Under **Settings**, choose Accelerator **GPU T4 ×2** (one T4 works without Bonsai) and switch **Internet** on.
2. Change `KEY = "CHANGE-ME"` in the second cell to a long secret, then **Run All**. The first run downloads the models and takes a while.
3. Copy the `https://….trycloudflare.com` address and the key it prints.
4. In Web Agent: **Models → Add connection → Kaggle GPU**, paste both, and choose a model. **Voice** fills in automatically.
5. Under **Voice**, click **Allow microphone** once. Chrome can't ask for it inside the side panel. Then choose **Whisper large-v3 turbo** or **Omi Med STT v1**, click **Check server** to see what's loaded, and **Record** to try it.

The tunnel address changes every time the notebook restarts. Update it under Models and Voice when that happens.

> **Sharing one local model with CareFlow:** CareFlow's in-app assistant also uses Ollama and warms the model up when its dashboard loads. On a 4 GB GPU both apps queue behind each other. Expect slow steps while CareFlow's assistant is busy, or point one of them at a different model or server.

---

## Architecture

```
 Side panel (React)                         Page (any website)
 ┌──────────────────────────────┐          ┌──────────────────────────────┐
 │ UI: chat, activity, approvals │          │ content.js (injected on use) │
 │            │ events           │ messages │  · page understanding        │
 │ Agent runtime (AgentRun)      │◄────────►│  · actions (click/type/…)    │
 │  planner → LLM → tools        │ typed    │  · highlight + presence glow │
 │  · site rules · approvals     │ protocol └──────────────────────────────┘
 │  · context pruning · history  │
 │            │ fetch            │          Background service worker
 │ LLM adapters: OpenAI-compat · │          · toolbar → side panel, Alt+Shift+A
 │   Ollama native · Anthropic   │          · Origin rule for local model servers
 └──────────────────────────────┘
          ▲  chrome.storage (config, history) ▼
 Configuration page (React) — agents, skills, tools, models, preferences, activity
```

### Decisions

- **The agent runs in the side panel, not the service worker.** MV3 service workers are stopped when idle, so a long model call could be killed mid-task. The panel is an extension page with full `chrome.*` access and stays alive while it is open. Closing it stops the task, which is also the safest behaviour. Tasks interrupted that way are marked “Interrupted” in history.
- **The content script is injected on demand** (`chrome.scripting`), not on every page. Nothing runs on a site until you give the agent a task there.
- **Element ids live in a `WeakMap`.** The page DOM is never modified, ids stay stable for the life of a document, and stale ids produce a clear error that tells the model to read the page again.
- **Events are dispatched the way frameworks expect.** Clicks use a pointer/mouse sequence followed by `click()`. Typing uses the native value setter plus `input`/`change`, so React/AntD controlled inputs register. Rich editors use `execCommand('insertText')`. Pressing Enter in a field calls `requestSubmit()`. Links with `target=_blank` are opened by the agent itself, because pop-ups opened by scripts are blocked.
- **After an action, the agent waits for the page.** If a navigation starts it waits for the load; otherwise it waits until the DOM has been quiet for 350 ms (at most 2.5 s).
- **Context is kept small.** Only the two latest page snapshots stay in full, older ones are replaced with a note, and long histories are trimmed. Follow-up requests carry only earlier requests and final answers, not tool traces.
- **Approvals are decided by generic rules** (`agent/execution/riskPolicy.ts`). They look at what a control says and the form it belongs to (password fields, payment fields, search forms), never at which site it is.
- **Small local models are supported.** Arguments are coerced (for example `"12"` becomes `12`), sloppy JSON is repaired, tool calls written as text (`<tool_call>…</tool_call>`) are recovered, `<think>` blocks are stripped, and repeating the same action three times triggers a nudge.

### Project structure

```
src/
  extension/
    background/        service worker
    content/           page understanding (elements, snapshot), actions, overlay
    browser/           BrowserController: tabs, injection, waiting, navigation
    messaging/         typed side panel ↔ content protocol
  agent/
    runtime/           AgentRun loop, events, context pruning
    planner/           system prompt
    execution/         risk policy (approvals)
    tools/             browser tools, custom HTTP tools, load_skill, registry, formatting
    llm/               provider-neutral types + OpenAI-compatible, Ollama, Anthropic adapters
  ui/
    app/               entry points, theme root
    pages/sidepanel/   chat, composer, agent switcher, activity history
    pages/options/     configuration pages and editors
    components/        activity timeline, approval card, markdown, brand, icons
    theme/ styles/     design tokens, Ant Design theme, CSS
  shared/              types, constants (tools catalogue, presets, defaults), storage, utils
  store/               Redux slices (config, chat, history) + chrome.storage sync
```

---

## Safety model

- **Approvals.** Each agent has its own policy: *Ask before important actions* (default), *Ask before every action*, or *Don't ask*. Custom tools can always ask before each use.
- **Site rules** in Permissions apply to every agent. *Blocked* sites can't be read or acted on. *Read-only* sites can be read but not changed.
- **Prompt injection.** The system prompt tells the model that page text is content, not instructions. Model output is rendered as Markdown with HTML and images switched off.
- **Privacy.** Pages are read only during a task, and only the model you chose sees them. Settings, keys and history stay in `chrome.storage.local`. Export leaves keys out unless you ask for them.
- **Browser limits.** Chrome doesn't allow extensions on `chrome://` pages, the Web Store or the built-in PDF viewer. The agent says so and can navigate somewhere else.

---

## Testing

```bash
npm test            # unit tests: site matching, risk policy, output parsing, schemas, context, formatting
npm run typecheck
```

End-to-end checks were run in Chrome for Testing with the built extension, driving the real side panel:

- **Scripted model, local test site:** form filling (text, native select, custom ARIA combobox), approval before Save, search → navigation → back, picking the right table row, a `target=_blank` link opening a new tab, Stop, saved history, and Origin-header removal. All 10 checks pass.
- **Qwen 3.5 4B on Ollama, test site:** filled and saved the full form, including the custom dropdown, with approval, in about 2 minutes. When the model skipped a required field, the browser's validation feedback led it to fill the field and save again, then confirm the success message.
- **Teams, against a scripted model on a three-form test page:** the coordinator split the request between 3 members; each worked in its own tab; 3 model calls ran at once (the whole task took 29 s); all four records were saved with an approval for every Save; the summary listed each member; and the tabs were tidied up. All 9 checks pass.
- **Kaggle GPU and voice, against a mock of the notebook's server API:** the Voice page lists the loaded engines; the fake microphone's audio is transcribed into the message box (Whisper, with the vocabulary); the key travels as `X-CareFlow-Key`; MedGemma reads the page and answers; and an unknown model that rejects tools falls back to read-and-answer. All 5 checks pass. The real notebook wasn't run here: it needs your Kaggle account.
- **Qwen 3.5 4B on Ollama, CareFlow PMS:** signed in (with approval), opened Patients and listed the first three patients correctly. It also completed *Tom Baker → Medications → Add medication → Paracetamol, 500 mg, twice daily (AntD Select) → Save* (with approval), and the new record appeared in the list.

- **Made-up selection (fixed):** a model claimed it had selected Luke King (who was on page 2 of the list) and invented his MRN and phone from the row above. Against a scripted model reproducing that exact answer, the double-check caught it: the agent searched, really selected the patient, and reported the real MRN. 4 of 4 checks pass. The local Qwen 3.5 4B now uses the search box (or the next page) for patients that aren't on page 1, and its answer is confirmed against the page.

## Known limitations

- Content in **cross-origin iframes** and **closed shadow roots** can't be read. The agent is told such frames exist.
- Events are synthetic (`isTrusted: false`). A few sites ignore untrusted events. Chrome DevTools Protocol input (`chrome.debugger`) would fix this but shows a “being debugged” banner, so it is not used.
- Small local models (≈4B) work but are slow on a 4 GB GPU and may need more steps. Larger or cloud models are much faster and more reliable on complex sites.
- Voice input needs the Kaggle notebook (or another server with the same `/transcribe` API). The notebook transcribes one piece of audio per request, so "streaming" works like the CareFlow bridge's: the extension detects speech and pauses itself (voice-activity detection against the room's background level) and sends each utterance, plus the audio so far every ~1.2 s for live text. Audio leaves the browser only while the microphone is on, and only the parts where someone speaks. In a loud room, use a longer pause or push-to-talk.

## Extending

- **A browser tool:** add its metadata to `shared/constants/tools.ts` and its implementation to `agent/tools/browserTools.ts` (zod schema, `label`, optional `assess`, `execute`). It then appears in Tools and in agent editors automatically.
- **A model provider:** implement `LlmClient` (`agent/llm/types.ts`) and register it in `agent/llm/index.ts` and `shared/constants/providers.ts`.
- **App-specific know-how** (for example CareFlow's navigation) belongs in a **skill** limited to that site, not in code.
