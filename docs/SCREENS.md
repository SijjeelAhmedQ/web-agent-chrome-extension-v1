# Small screens and pages that don't fit them — Phase 3

Does the agent work when the screen is small, or the page wasn't made for it? Each task is run with the site's tab
shown at a set size (Chrome's device emulation, held for the whole task), and the result is checked **on the page**
(its address, the form's values, what the page says) — not taken from the agent's answer.

- **Harness:** [`scripts/screen-bench.mjs`](../scripts/screen-bench.mjs) — `node scripts/screen-bench.mjs <label> <phone|tablet|laptop|desktop|WxH> [tasks] [tab]`.
  `MOBILE=0` gives a narrow *desktop* window (the page laid out at that width and scrolling sideways — what the
  extension really meets: a small window, or the side panel taking room) instead of a phone's zoomed-out view.
- **A page made not to fit:** [`tests/screen/nonresponsive.html`](../tests/screen/nonresponsive.html), served by
  `node tests/screen/serve.mjs` on http://localhost:8765 — a fixed 1400px layout with no viewport tag: its menu and
  form far to the right, a table that scrolls inside a box, a hover-only menu at the right edge, a button under a
  fixed cookie banner, a link that only a real mouse click works, and a search box in the header.
- Model: Claude Haiku 5.5 · 26 Nov 2026.

## OctansCare (responsive) — the five benchmark tasks

| Size | Passed | Calls | Cost |
|---|---|---|---|
| Phone 375×667 | **5/5** | 18 | $0.0130 |
| Tablet 768×1024 | **5/5** | 19 | $0.0100 |
| Laptop 1366×768 | **5/5** | 17 | $0.0093 |

Open practice members · find talha asghar (asks which of three) · count Steiner Wing stations (19) · fill two fields ·
fill five fields — each checked on the page.

## The page that doesn't fit (legacy portal)

| # | Task | What makes it hard |
|---|---|---|
| 1 | Open Reports from the top menu, say the total | the menu sits at x 1050+, off a small screen |
| 2 | Fill Full name, Email, Plan; press Preview | the form and its button are at x 900–1360 |
| 3 | Click View for order 1027 | the button is in a table that scrolls sideways inside a box |
| 4 | Click Continue at the bottom | a fixed cookie banner covers it |
| 5 | More menu → Export | the menu opens only on hover, at the page's right edge |
| 6 | Click Download invoice | at x 1290, and only a real mouse click works |
| 7 | Search the orders in the header box | the box is at x 860, and it searches on Enter |

| Window | Passed | Calls | Cost |
|---|---|---|---|
| Laptop 1366×768 | **5/5** (tasks 1–5) | 12 | $0.0032 |
| Phone 375×667 (zoomed out, as a phone shows it) | **5/5** (tasks 1–5) | 12 | $0.0023 |
| Narrow desktop 375×667 (scrolls sideways) | **7/7** | 16 | $0.0034 |
| Narrow desktop 768×1024 | **7/7** | 16 | $0.0033 |

**Found:** nothing that breaks at a small size. Controls off the screen are found (the page read lists them, marked
outside the visible area) and clicked: a script's click doesn't need them on screen, and the real mouse click (task
6) scrolls the page sideways to them first.

**Seen along the way (not about screen size):** a few answers carried the model's own working into the reply
(“order 37? No: …”, “No further tool call is needed”) — to look at with the answer prompt.
