# Test scripts

Two kinds, both Puppeteer (install once in the folder you run from: `npm i puppeteer`).

## `e2e-mocks/` — the agent on mock pages, with a scripted model

- `server.mjs` serves the mock site (`site/`, port 4599) and a mock model (port 4600) that answers each scenario
  (the first words of the request: “records status”, “form save”, “task form”…).
- Each `*-e2e.mjs` is a suite: `node formbuttons-e2e.mjs <path to dist>` — prints PASS/FAIL per check.
- Start the server first: `node server.mjs`.

## `live-indici/` — the agent on the real Indici training site (pmstraining.vitonta.com)

Only with the user's leave; writes only as the user allowed (see the runner's `APPROVE`).

1. `node indici-browser.mjs <extension copy>` — opens Chrome with the extension; log in by hand there (reCAPTCHA/MFA).
   Profile: `C:/Users/92313/.webagent-indici-profile`; extension copy: `C:/Users/92313/.webagent-ext`.
2. After a build: `node live-reinstall.mjs` (the login stays). `node live-keeper.mjs` keeps a blank tab so the window never closes.
3. `REQUESTS='["…"]' APPROVE='regex' node live-agent.mjs` — the real agent with DeepSeek (key read from
   `C:/Users/92313/.webagent-openrouter.env`, never printed). Approvals are declined unless their text matches
   `APPROVE`; `NO_ANSWER=1` only shows the approval card. Log: `agent-run.log`, model calls: `model-calls.json`.
4. Read-only helpers: `live-do.mjs` (clicks/typing/captures; refuses Save-like buttons), `live-agent-view.mjs`,
   `live-describe.mjs`, `live-icons.mjs`, `live-find.mjs`, `live-tabs.mjs` — what the content script reads on the live page.

Paths inside the scripts point at the scratch folder they were written in; adjust `DIR` when moving them.
