# Testing

```bash
pnpm lint              # eslint, 0 errors expected
pnpm typecheck         # tsc --noEmit across all 9 projects
pnpm test              # vitest unit suite
pnpm test:integration  # vitest against real Postgres + Redis
pnpm test:e2e          # Playwright
pnpm check             # lint + typecheck + test + build
```

## Unit suite

Pure logic lives in `packages/shared/src/` precisely so it can be tested without
Prisma, Fastify or React. Anything with a rule worth arguing about belongs
there: share availability, file-request policy, upload lifecycle, idempotency,
math parsing, device routing, delivery limits.

## Integration suite

Runs against a **dedicated `arciin_test` database and Redis db 15**, derived
from `.env` at load time so no credentials live in the repo.
`tests/integration/guard.ts` re-checks the resolved values and aborts the run if
anything still points at a production resource.

Set it up with:

```bash
pnpm test:db:setup
```

If integration tests fail with Prisma column errors after a schema change, the
test database is behind:

```bash
TEST_URL=$(node -e 'require("dotenv").config({quiet:true});const u=new URL(process.env.DATABASE_URL);u.pathname="/arciin_test";process.stdout.write(u.toString())')
DATABASE_URL="$TEST_URL" pnpm exec prisma db push --skip-generate
```

## Browser tests

Playwright with Chromium. Traces, screenshots and video are retained on failure
under `reports/` and `test-results/`, both of which are gitignored and
lint-ignored — so they never reach a commit or a lint run.

**Known failing: 3 authentication tests.** The login fixture cannot find
`input[type="email"]` on the dev instance. Until that is fixed the 20/20 Pro
refresh gate has never actually run in a browser.

### The `/book` acceptance suite

`tests/e2e/book.spec.ts`, `book-controls.spec.ts` and `book-retry.spec.ts` drive a real
browser against a real model and write a real three-chapter book. They are the
only tests here that spend tokens, so they are opt-in:

```bash
E2E_BOOK=1 npx playwright test book --project=chromium
```

They exist because `/book` shipped twice with a full green stub suite and
stopped after chapter one in production both times. Both causes lived in seams a
stub replaces — the transport's lifetime, the route's lifetime — so the stub
suite could not have caught either. What these assert is what a reader would
notice: chapter 2 and 3 start with nobody typing "continue", the run keeps going
while Chat is unmounted and the reader is on All Files and Settings, the AI Tasks
entry in the sidebar reports the real phase, returning to Chat shows the chapters
written while away, Pause finishes the chapter in flight and then stops, Resume
writes the chapter actually missing from the document, Retry writes it exactly
once, a real browser reload recovers as paused rather than relaunching, and the
saved manuscript contains none of the `[carry:…]` control tags while the memory
still holds them.

They need a model profile with a working key on the **dev** instance
(`arciin_dev`), and a Pro licence — the seed's Pro claim carries no signed token,
so a long run gets downgraded to Free mid-test and the composer locks. Activate a
dev key first:

```bash
ARCIIN-DEV-PRO
```

They do **not** need idle logout disabled. The watcher now defers a sign-out
while an AI task is running (see `SECURITY.md`), and the specs also nudge the
mouse between polls so the session behaves like a reader who is actually there.
An earlier version of this suite needed the instance setting changed by hand,
which hid the very bug that deferral fixes.

The orchestrator's `[book]` trace is compiled out of production builds. Turn it
on per browser with `localStorage.setItem("arciin:book-debug", "1")`; the specs
do this themselves, and it is the only way to diagnose a run that stops.

### Two computers, one book

`tests/e2e/book-cross-device.spec.ts` is the only test that opens a **second
browser context**. Browser A starts a real book; Browser B signs into the same
account with its own session and must see the same run — sidebar spinner, hover
detail, History row, progress card and the manuscript already written — without
generating anything.

```bash
E2E_BOOK=1 npx playwright test book-cross-device --project=chromium
```

The assertion that matters is the last one: `generation_started` must never
appear in B's trace, and no chapter may be appended twice. Run state lives in
`BookRun` with an executor lease, so a second computer becomes an observer
rather than a second payer.

`tests/e2e/book-observer-ui.spec.ts` proves the same *visibility* properties in
about 90 seconds by seeding the run through the real endpoint instead of writing
a book, so it runs on every change:

```bash
npx playwright test book-observer-ui --project=chromium
```

It covers what the reader sees on the second computer — sidebar spinner, hover
detail, History row, progress card with the "On another computer" badge and no
Pause button, and the persisted manuscript in the Canvas — plus the two rules
underneath: an observer's claim is refused with 409 and leaves the executor's
state untouched, and a settled run belongs to no session.

Five traps these specs have already fallen into, all of which produced a
*passing-looking* or mysteriously hanging test:

- **A second context is not a second computer.** `browser.newContext()` inherits
  the project's `storageState`, so B carried A's session cookie, the server saw
  one session, and it reported the observer as the executor. B must pass
  `storageState: undefined` and genuinely sign in. This is the single most
  important line in both specs.
- **Matching a leftover run.** The dev database is shared between specs. An
  earlier version polled for "a run exists", matched a run seeded by
  `ai-task-indicator.spec.ts`, and passed its opening assertions in 28 seconds
  without writing a book. It now snapshots the conversation ids that existed
  before it started and only accepts a new one.
- **Seeding the browser store.** `ai-task-indicator.spec.ts` used to push a
  project into the module-level store. That stopped driving the indicator the
  moment it began reading shared state, so it now seeds through the real
  `PUT /conversations/:id/book-run` route.
- **Letting the lease lapse.** It lives 45 seconds, and a first-compile
  navigation in the dev server can outlast that, after which the run correctly
  reads as INTERRUPTED and B is shown a paused book. A seeded test has to run a
  heartbeat the way the orchestrator does.
- **Fixtures a reader would never have.** A conversation with no messages renders
  the template picker rather than the message list, and the progress card lives
  in the message list — so the card was invisible for a reason that had nothing
  to do with the feature. And History is a panel opened from the header chip
  whose accessible name is "History", not its `title` of "Show history".

Authorization has its own coverage in `tests/integration/book-run-access.test.ts`:
a run is reachable only through a conversation scoped to the caller, so knowing
a conversation id grants nothing.

### The anti-vacuous-pass guard

`expectChatPageRendered()` asserts the URL contains `/chat` **and** the composer
is visible, before any assertion about paywalls.

This exists because two entitlement tests once passed for the wrong reason: the
app had redirected to `/login`, where the paywall text does not exist, so
`expect(page).not.toContainText("Upgrade")` passed on an empty page. A test that
cannot fail is worse than no test. Do not remove the guard to make tests green.

## What tests are for here

Several tests in this repo encode a decision rather than a behaviour, and their
comments say which. Two examples worth knowing before you "simplify" them:

- `tests/delivery-policy.test.ts` fails if a delivery tool ever gains a
  `to`/`recipient`/`webhook_url` argument. That is a security control.
- `tests/latex-math.test.ts` asserts KaTeX `trust: true` *would* produce a real
  link, so nobody deletes `trust: false` as a redundant default.

## Verifying against production

Some things cannot be proven by unit tests — SMTP sockets, public upload
endpoints, tunnel routing. When verifying against a live instance:

1. Create temporary fixtures (session, folder, request) and **record their ids**.
2. Exercise the path.
3. Delete every fixture and confirm zero leftovers with a count query.
4. Never point automated tests at the production database.

The 2026-08-12 File Request verification followed this: three assets, one
request, one folder and one session created and removed, verified clean
afterwards. Email delivery was proven against a local SMTP sink on port 2525
rather than the owner's real account, and the instance config was restored to
its previous state.
