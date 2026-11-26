# Web Agent — Architecture

How the extension is built: what runs where, how the pieces talk, where data lives, and how the agent does a task.
Kept up to date with each phase (last update: Phase 5, 2026-11-26).

## At a glance

Web Agent is a **Chrome Manifest V3 extension** with no server of its own. The agent runs **inside the browser**, in
the side panel, and calls an AI model you choose (OpenRouter, Anthropic, OpenAI, Ollama, or the Kaggle GPU notebook).
It sees a website only through a small content script it injects on demand, and acts on the page with generic
browser tools (read, click, type, select…) — there is no code written for any particular website.

| Layer | What it is | Technology |
|---|---|---|
| Frontend | Side panel (chat) and Options page (configuration) | React 18, TypeScript, Ant Design 5, Redux Toolkit, React Router, lucide-react |
| “Backend” | The agent loop, running in the side panel page; a small background service worker | TypeScript, Chrome extension APIs |
| Page access | Content script injected into the tab when needed | Plain TypeScript (no React), built as one IIFE file |
| AI models | Any OpenAI-compatible API, Anthropic, Ollama | `fetch` from the side panel; tool calling with JSON schemas from Zod |
| Speech | Kaggle GPU notebook (Whisper large-v3 turbo, Omi Med STT) or Chrome's own speech recognition | FastAPI server in `kaggle/`, Web Speech API |
| Database | `chrome.storage.local` / `.session`, through one module | Moving to Firebase later (see the end) |
| Build & tests | Vite 6, `tsc -b`, Vitest + jsdom (430+ tests) | `npm run build`, `npm test` |

## The four parts of the extension

```
┌──────────────────────────── Chrome ─────────────────────────────┐
│                                                                  │
│  Side panel (sidepanel.html, React)        Options page (React)  │
│  ├─ chat UI, approvals, voice dialog        agents, sites,       │
│  ├─ AgentRun — the agent loop               knowledge bases,     │
│  ├─ BrowserController ───────────┐          models, voice…       │
│  └─ LLM clients ── fetch ──► AI model API                         │
│              │                   │                                │
│              │   chrome.tabs.sendMessage / chrome.scripting       │
│              │                   ▼                                │
│              │        Content script (content.js) in the tab      │
│              │        reads the page, clicks, types, fills forms  │
│              │                                                    │
│              └── chrome.storage (config, history, cost) ◄── both pages
│                                                                  │
│  Background service worker (background.js) — small:              │
│  opens the panel (toolbar icon, Alt+Shift+A), strips the Origin  │
│  header for localhost model servers, keeps the backup file.      │
└──────────────────────────────────────────────────────────────────┘
```

1. **Side panel** (`src/ui/pages/sidepanel`, entry `src/ui/app/sidepanel.tsx`). The chat. It also *hosts the agent*:
   `useAgentRunner` creates an `AgentRun` (or a `TeamRun`) for each request, and the run's events (steps, approvals,
   answer) flow into the Redux store and onto the screen.
2. **Options page** (`src/ui/pages/options`, entry `options.tsx`). Configuration: agents, skills, tools, models,
   voice, sites, knowledge bases, preferences, activity and cost.
3. **Content script** (`src/extension/content`). Injected into a tab only when the agent needs it. It turns the page
   into a compact list of elements with ids (`[12] button "Save"`), and performs actions on those ids. It never sends
   raw HTML to the model.
4. **Background service worker** (`src/extension/background`). Deliberately small, because Chrome stops MV3 workers
   when idle — which is why the agent runs in the side panel, not here.

### Why the agent runs in the side panel

An MV3 service worker can be stopped at any moment; a task can take minutes. The side panel is an extension page that
stays alive while open and has full `chrome.*` access (tabs, scripting, debugger, downloads), so the whole loop —
model calls, tool calls, approvals — lives there. Closing the panel stops the task; the chat is kept in
`chrome.storage.session` and comes back when the panel reopens.

## How React runs in the extension

- Vite builds two HTML pages, `sidepanel.html` and `options.html`. Each loads a normal React 18 app
  (`createRoot`) with its own Redux store, Ant Design theme (light/dark) and router (options only).
- Chrome shows `sidepanel.html` in the side panel (`"side_panel"` in `public/manifest.json`) and `options.html` in a
  tab (`"options_ui"`).
- Both pages read and write the same data in `chrome.storage`; a change saved on one page reaches the other through
  storage change events, so the side panel picks up a new setting without a reload.
- The content script is **not** React. It is built separately (`vite.content.config.ts`, IIFE format) because
  content scripts can't be ES modules, and it must stay small and touch nothing on the page until asked.
- MV3 forbids remote code: everything is bundled; fonts come from `@fontsource` packages.

## How a task runs

```
request ─► pick knowledge for this page ─► model call (system prompt + tools + page) ─► tool calls ─► …
                                                     ▲                                       │
                                                     └──── result + the page as it is now ◄──┘
                                            … until the model answers ─► check the answer against the page
```

1. **Context.** `buildSystemPrompt` (rules, the same every task, so the provider's prompt cache serves it) and
   `buildTaskContext` (the site's knowledge for this request and page, and the current tab).
2. **Knowledge selection** (`src/agent/planner/siteKnowledge.ts`). From the site's knowledge base: entries about the
   current page, entries whose titles match the request, then navigation and rules while there is room.
3. **The loop** (`src/agent/runtime/agentRun.ts`). The model answers with tool calls; each is validated with Zod,
   checked against site rules (blocked, read-only, never-click), put to the user for approval if it saves, sends,
   deletes or pays, and executed through `BrowserController` → content script. The result goes back with the page as
   it is now.
4. **Asking.** A value the user didn't give is asked with `ask_user`: the task waits on a question card and continues
   with the answer. Approvals are the confirmation for saving — the agent doesn't also ask in the chat.
5. **The answer.** Before claiming something was saved, the agent checks the page (a success message, the new
   record). The answer is cleaned of the model's own working (`cleanAnswer.ts`).
6. **Cost.** Every model call's tokens and dollars are logged per task and per day (Cost page), with an optional
   spending limit per task.

Token savings used (details in `docs/TOKENS.md`): prompt caching, page-scoped knowledge, a small toolset for
click-only tasks, compact page snapshots, page diffs instead of full re-reads, and optional Headroom compression
(per model connection, off by default).

## Where data lives (the “database”)

All storage goes through **one module**, `src/shared/storage/storage.ts` — a test makes sure nothing else calls
`chrome.storage`. That is what makes the Firebase move a single new backend rather than changes everywhere.

| Key | Area | What |
|---|---|---|
| `wa.config` | local | Everything you set up: agents, skills, custom tools, model connections (with their API keys), sites, knowledge bases, voice and other settings |
| `wa.history` | local | The last 200 tasks with their steps, model calls and results (can be turned off) |
| `wa.costLedger` | local | Daily spending by model and site — numbers only |
| `wa.backupAt`, `wa.freshInstall` | local | Backup bookkeeping; offering to restore after a reinstall |
| `wa.chat` | session | The open chat, so it survives the panel being closed (gone when the browser closes) |

A **backup file** is written to `Downloads/WebAgent/web-agent-backup.json` without secrets (API keys emptied), and
the Options page can restore from it.

### Knowledge

- A **knowledge base** is what the Knowledge Gather Agent learned by crawling a site (`src/agent/crawler`), or what
  you uploaded as Markdown: rules, navigation, page descriptions and workflows, plus buttons never to click.
- A **site** (Site base) adds per-site agents, skills, tools and model. When a site has an enabled knowledge base, the
  agent uses the knowledge base's entries and never-click list in place of the site's own (`sitesFor` in
  `src/agent/tools/registry.ts`); the site editor shows and edits that same knowledge.

## Outside the browser

- **AI model providers** are called directly from the side panel with the user's own key (OpenRouter, Anthropic,
  OpenAI) or to a server they run (Ollama, LM Studio, llama.cpp, vLLM).
- **Kaggle notebook** (`kaggle/careflow_kaggle.ipynb`, server `kaggle/careflow_gpu_server.py`): a FastAPI server on a
  free Kaggle GPU, reached through a Cloudflare tunnel, with a key. It serves speech recognition (`/transcribe`,
  Whisper or Omi; English, Urdu, Hindi) and local language models through Ollama.

## Voice

Tap the microphone and a listening dialog opens: words appear as they are recognised (grey while still a guess,
bold when sure); a pause sends them. Short commands run without the model: “open stations” goes straight to the page
from the site's map (`src/shared/voice/navigate.ts`), “yes”/“no” (also “haan”/“nahi”) answer an approval, “stop”
stops. For a spoken request, the approval question is spoken back (`speechSynthesis`) and the dialog listens for the
answer. Engines: Whisper/Omi on the Kaggle server, or Chrome's speech recognition.

## Safety

- Approval before anything that saves, sends, deletes, submits or pays — one approval, not two.
- Per site: blocked or read-only sites; buttons never to click; controls and pop-ups that always ask.
- Page text is treated as data, never as instructions; passwords are typed only when given for that purpose.
- Exported files and backups have API keys removed.

## Code map

```
src/
  agent/        the agent: runtime (AgentRun, approvals, ask_user, checklist), planner (prompts, knowledge),
                tools (browser tools, custom tools), llm (provider clients, Headroom), crawler, responsive
  extension/    background worker, BrowserController (tabs, injection, debugger), content script, messaging
  shared/       types, constants, storage (the one storage module), voice (speech, commands, navigation), utils
  store/        Redux slices: config, chat, history
  ui/           React: app entries, pages (sidepanel, options), components, hooks, styles
kaggle/         the GPU notebook and its server
scripts/        token and screen benchmarks
docs/           TOKENS.md (token savings), SCREENS.md (small screens)
```

## Next: Firebase (planned, last)

The plan for the move, done after everything else:

- **Firestore** `users/{uid}/sites/...` (and the user's config, knowledge bases, history) behind a Firebase
  backend for `storage.ts`.
- **Security rules** so each user reads and writes only their own data.
- **Firebase Auth** to sign in.
- **LLM calls through Firebase Functions**, so API keys no longer live in the extension (needs the Blaze plan).
- **No patient data stored** — only setup, knowledge and numbers.
