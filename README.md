# ✦ Starsplit

[![Tests](https://github.com/Karthik705/starsplit/actions/workflows/tests.yml/badge.svg)](https://github.com/Karthik705/starsplit/actions/workflows/tests.yml)

**Live demo:** [starsplit.onrender.com](https://starsplit.onrender.com) (click **Explore a demo trip, no sign-up** to land in a populated group as a guest; on the free tier the first visit after a quiet period takes about a minute to wake the server)

Split expenses with friends, and watch the tangled web of IOUs **untangle into a constellation**.

Most expense splitters show you a list of numbers. Starsplit turns each group into a night sky: every person is a star, every debt is a glowing line flowing from debtor to creditor. Flip the **Tangled ↔ Untangled** toggle and the raw who-owes-who web collapses into the minimum number of payments that settles everyone.

![Group view](docs/group.png)

![Insights](docs/insights.png)

## What makes it different

**1. The provably fewest payments.** Most expense apps settle up *greedily*: match the biggest debtor with the biggest creditor, repeat. That never needs more than *n − 1* payments, but it often isn't the minimum. Starsplit computes the **exact optimum**.

The key observation: if the *k* people with a non-zero balance can be split into *m* groups whose balances each sum to zero, every group can settle on its own in *(size − 1)* payments, for *k − m* in total, and no plan can do better. So the minimum number of payments is *k − (largest zero-sum partition)*. That problem is NP-hard in general, but a group has at most 12 people, so a DP over all 2^k subsets solves it exactly in milliseconds:

```
dp[mask] = max over i in mask of dp[mask without i]   (+1 if mask's balances sum to 0)
```

Walking back from the full set, the zero-sum masks along the best path are nested; their differences are the groups. See [`settlePlan` in src/shared/ledger.mjs](src/shared/ledger.mjs). The tests check it against a brute-force search on 300 random ledgers, and show a case where greedy needs 4 payments and Starsplit needs 3.

**2. The sky splits into circles.** Those zero-sum groups are shown, not just computed. In the *Untangled* view each one becomes its own sub-constellation inside a coloured nebula, and the payment list is grouped by circle: "Rohan, Isha and Kabir can settle among themselves." The demo trip is built so that greedy would need 4 payments and the app shows why 3 is enough.

**3. A time machine for the ledger.** Balances are never stored: they're derived from the ledger (expenses + payments), the single source of truth. So any moment of the trip can be rebuilt exactly. Press ▶ under the constellation, or scrub the slider, and watch the debts form entry by entry. The browser imports the *same* `ledger.mjs` module the server runs, so the replay can't disagree with the server.

## Features

- **iOS/macOS-inspired design**: system typography, automatic light/dark mode (plus a manual toggle), translucent nav bar with a collapsing large title, sliding segmented controls, iOS-style switches, a bottom-sheet editor, and spring animations. Uses the View Transitions API where supported and honours `prefers-reduced-motion`.
- **Accounts**: sign up / log in with email and password. Passwords are hashed with scrypt, sessions are random tokens in an httpOnly, SameSite cookie (only a SHA-256 of the token is stored), login is rate-limited and timing-safe. Your groups are saved to your account; opening an invite code adds that group to it.
- **Sign in with Google** (OAuth 2.0 authorization-code flow with a state cookie, no SDK) and **forgot password** (single-use, 30-minute reset links emailed via Resend; resetting signs out all other sessions).
- **Landing page** for visitors, with a one-click **guest demo** (a throwaway 2-day guest account, no password), and a personal dashboard of your groups once logged in.
- **Manage people**: rename the group, add, rename or remove people (removal is blocked while someone is part of an expense).
- **Undo** for deleted expenses and payments, a searchable ledger grouped by day, and an installable web app (manifest + icon).
- Create a group ("constellation") with a shareable 6-character code that friends can open to join.
- **Four ways to split**: equally, exact amounts, percentages, or shares (e.g. 2 nights vs 1 night), with live per-person previews. Edit any expense afterwards.
- **Interactive constellation**: drag the stars around; comets flow along each debt; star size and glow reflect balance. Layout is remembered per group.
- **Tangled ↔ Untangled** toggle: raw who-owes-who vs. the minimum set of payments (min-cash-flow).
- **Insights**: spending by category (donut), cumulative spending over time (hover crosshair), and paid-vs-used per person.
- **Wrapped**: Spotify-style awards for the trip (The Backbone, Biggest Appetite, Priciest Moment…).
- **Live sync**: open the same code on two devices and changes appear instantly (server-sent events).
- One-click "Mark paid" settlements with a celebration when everyone is square, CSV export, and a copy-paste settle-up message for the group chat.
- "Try a demo trip" button, deep links (`#/g/CODE/insights`), responsive, respects `prefers-reduced-motion`.

## Tech stack

| Layer    | Choice |
|----------|--------|
| Backend  | Node.js + Express (REST JSON API) |
| Database | SQLite / libSQL via `@libsql/client`: a local file in development, a hosted [Turso](https://turso.tech) database in production |
| Frontend | Vanilla JS, hash routing, hand-written SVG and CSS (no build step) |
| Realtime | Server-sent events (`EventSource`), no WebSocket library needed |
| Tests    | `node:test` (unit tests for money logic + API integration tests) |

## Run it

Requires **Node 22.13+**.

```bash
npm install
npm start        # http://localhost:3000
npm test         # 20 tests: money logic (incl. brute-force check of the exact settle-up) and the HTTP API
```

## How it works

- **Money is stored as integer cents** so there is no floating-point drift. Every split mode goes through one largest-remainder allocator, so shares always sum exactly to the total ([src/shared/ledger.mjs](src/shared/ledger.mjs)).
- **Charts are hand-written SVG.** Category colours come from a palette checked for colour-blind separation and contrast on the dark background; every chart has hover tooltips and its numbers are also shown as text.
- **Balance** = what you paid − your share of everything. Balances always sum to zero.
- **Tangled view**: direct pairwise debts, netted per pair.
- **Untangled view**: the exact minimum number of payments (see *What makes it different*), with greedy min-cash-flow used inside each circle and as a fallback above 18 people.
- **Settling up** is stored as a `payment` entry, so balances stay derived from one source of truth (the ledger) and deleting an entry just works.
- Multi-step writes (expense + its splits) run in a SQL transaction; the server validates all input and returns clear 4xx errors.

## API

Everything except `/api/auth/*` requires a logged-in session.

| Method | Route | Purpose |
|--------|-------|---------|
| POST   | `/api/auth/signup` | Create account `{name, email, password}`, sets session cookie |
| POST   | `/api/auth/login` | Log in `{email, password}` |
| POST   | `/api/auth/logout` | End the session |
| POST   | `/api/auth/forgot` | Email a reset link `{email}` (same answer whether or not the account exists) |
| POST   | `/api/auth/reset` | Set a new password `{token, password}` |
| POST   | `/api/auth/guest` | Start a 2-day guest session (rate-limited), used by the landing page demo |
| GET    | `/api/auth/google` | Start Sign in with Google |
| GET    | `/api/auth/me` | Current user or `null` |
| GET    | `/api/me/groups` | Your groups with totals |
| DELETE | `/api/me/groups/:code` | Remove a group from your account |
| POST   | `/api/groups` | Create group `{name, currency, members[]}` → `{code}` |
| GET    | `/api/groups/:code` | Members, ledger, balances, raw and simplified debts |
| PATCH  | `/api/groups/:code` | Rename group `{name}` |
| POST   | `/api/groups/:code/members` | Add a person |
| PATCH  | `/api/groups/:code/members/:id` | Rename a person |
| DELETE | `/api/groups/:code/members/:id` | Remove a person (only if not in any expense) |
| POST   | `/api/groups/:code/expenses` | Add expense `{description, amount, paidBy, category, date, splitType, split}` |
| PUT    | `/api/groups/:code/expenses/:id` | Edit an expense (same body) |
| GET    | `/api/groups/:code/events` | Server-sent events stream for live updates |
| POST   | `/api/groups/:code/settle` | Record payment `{from, to, amount}` |
| DELETE | `/api/groups/:code/expenses/:id` | Remove an entry |

## Configuration

All optional locally (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Hosted database; without them a local SQLite file is used |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enables "Continue with Google" |
| `RESEND_API_KEY`, `MAIL_FROM` | Sends reset emails; without it they're printed to the console |
| `APP_URL` | Public URL used in emails and the OAuth redirect |

## Deploy

The app is a single Node process. It uses a hosted libSQL database (Turso) when `TURSO_DATABASE_URL` is set and a local SQLite file otherwise, so any host that runs Node works.

- **Render**: `render.yaml` is included (free plan, health check at `/healthz`). With `TURSO_DATABASE_URL` set, data lives in Turso and survives redeploys on Render's ephemeral disk; without it, attach a persistent disk and set `DB_FILE=/var/data/starsplit.db`.
- **Docker**: `docker build -t starsplit . && docker run -p 3000:3000 -v starsplit-data:/data starsplit`

Production notes: per-IP rate limiting on writes, security headers, `trust proxy` for correct client IPs, and SSE responses are unbuffered so live sync works behind proxies.

## Project layout

```
src/
  server.js      Entry point (listen, graceful shutdown)
  app.js         Express setup: headers, static files, error handling
  auth.js        Accounts, password hashing, sessions
  routes.js      REST routes for groups, members and the ledger
  store.js       Prepared SQL queries + derived group state
  validate.js    Input cleaning and expense parsing
  shared/ledger.mjs  Pure money logic: splits, balances, exact settle-up (shared with the browser)
  balance.js     CommonJS re-export of shared/ledger.mjs
  live.js        Server-sent events rooms
  db.js          SQLite schema + transaction helper
public/
  index.html     Shell
  css/           tokens, base, components, home, group, charts, sheet, responsive
  js/            ES modules: main (router), home, group, sky, constellation,
                 timeline (time machine), insights, wrapped, expense-sheet,
                 people-sheet, landing, auth-page, actions, ui, util
test/            balance.test.js, api.test.js
```

## Ideas for next steps

Multi-currency groups, receipt photos, offline queueing of edits.

## License

MIT, see [LICENSE](LICENSE).
