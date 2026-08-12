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
