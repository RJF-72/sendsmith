# SendSmith — Build Report

**What this is:** the archived mozilla/send codebase (Firefox Send
v3.0.22, upstream HEAD `ade10e4`, MPL-2.0), modernized and rebranded
into **SendSmith** — *"Send it. Gone. — encrypted file transfer that
self-destructs."* — following the modernize-first path. Built entirely
in `~/workspace/sendsmith` (fresh git history; first commit is the
pristine upstream import). **Nothing was pushed, deployed, or bought;
no real credentials exist anywhere in the tree** — every integration
is env-gated and off by default.

**Bottom line:** the product boots and passes its full verification
matrix on both Node 22 LTS and Node 24, against an in-memory Redis
mock, a real Redis 7.4.2, local disk, and a live S3-compatible
endpoint. It is launch-*shaped*; the remaining blockers are Ray's
infrastructure decisions, listed at the end.

---

## Commits (local only)

| Commit | Contents |
|---|---|
| `ac38a0e` | Pristine upstream import (mozilla/send v3.0.22) |
| `1ef704e` | Phase 1+2 core: modern stack, server rebrand, accounts/abuse/billing modules |
| `63cb91d` | Phases 2–5: frontend accounts, locale cut, shells removed, docs, Docker |
| `249798f` | Fixes found by real-Redis + live-S3 verification |
| `23c3ae4` | Lint health + housekeeping |
| (this report) | BUILD_REPORT.md |

## Phase 1 — Modernize (Node 22 LTS target)

Two hard boot blockers were removed, not worked around:

- **mozlog/intel** (the `util.isError` crash) → replaced with **pino**
  behind a same-shaped factory (`server/log.js`): structured JSON
  logs, component names preserved.
- **@dannycoates/express-ws** — an abandoned fork that drags in the
  abandoned `esm` loader, which crashes modern Node — replaced with a
  small owned module, `server/wsServer.js`, wiring the standard `ws`
  package's upgrade handling to the upload route (including the
  express-isms the handler uses: `req.ip`, `req.get`, `req.geo`,
  `req.protocol`).

Upgrades: redis client 3 → **@redis/client v5** (storage facade in
`server/storage/redis.js`, exposing the `*Async` surface the codebase
uses); **aws-sdk v2 → v3** (`server/storage/s3.js`: S3Client +
commands + lib-storage `Upload`, endpoint/force-path-style/region for
R2/B2/MinIO); **helmet 3 → 8**; **node-fetch removed** for native
fetch; **Fluent 0.19** API in both locale modules; **convict 6**
(the removed `ipaddress`/`url` formats are re-registered on platform
APIs); **webpack 4 → 5** (asset modules, MiniCssExtractPlugin,
CopyPlugin/WebpackManifestPlugin v5 APIs, build passes **without**
`--openssl-legacy-provider`); **Tailwind 1 → 3** (theme `DEFAULT`
keys, `content` scanning, class renames in the UI). Removed entirely:
configstore, mkdirp, git-rev-sync (replaced by a 20-line internal
version plugin), selenium/puppeteer stack, husky/lint-staged.

**Test change (documented, as required):** only one upstream test file
was rewritten — `test/backend/s3-tests.js` — because it asserted the
aws-sdk v2 API surface that no longer exists. It now stubs SDK v3
command objects and asserts the same behaviors (get/set/del,
not-found → undefined, source-error aborts the upload). All other
upstream backend tests are byte-identical to upstream.

**Advisory counts (OSV method — npm's audit endpoint is unreachable
from this sandbox: the registry audit call times out, same as during
evaluation):** sampling the *direct* dependencies of each lockfile
against the OSV API: upstream **86 deps → 33 advisories across 13
packages** (convict 5, morgan 3, svgo 3, ua-parser-js 3, aws-sdk 2,
body-parser 2, express 2, node-fetch 2, redis 1, webpack-dev-server 6,
…). SendSmith: **71 deps → 6 advisories, all in webpack-dev-server
4.15.2** — a dev-only dependency that is not in the production image.
Package count dropped 2,073 → ~1,270.

## Phase 2 — Rebrand to SendSmith

- Deleted `assets/firefox_logo-only.svg` (the real Firefox logo);
  created original SVG artwork in a charcoal (#2b2320) + ember
  (#ff7a1a) palette: `assets/icon.svg`, `assets/wordmark.svg`,
  `assets/master-logo.svg` (anvil + ember paper plane).
- `server/state.js`: title **SendSmith**, SendSmith tagline
  description; webmanifest name/short_name/theme; config defaults:
  `BASE_URL` no longer points at send.firefox.com, Sentry DSN/host
  default to empty (telemetry is the operator's own, opt-in only).
- The hardcoded `wss://send.firefox.com` in `app/api.js` is gone —
  the socket URL derives from the serving origin.
- Share text, `public/contribute.json`, unsupported-browser and
  no-streams surfaces: Mozilla links/promos replaced with generic
  browser guidance (browsehappy).
- **Locales: 86 → en-US only** (`availableLanguages: ["en-US"]`); the
  Fluent machinery is untouched so locales can return. en-US strings
  rebranded (brand terms, Firefox-promo strings); **string IDs are
  unchanged**, so no missing-string breakage.
- **Mobile shells: CUT from launch scope.** `android/` and `ios/` are
  deleted (plus the Android webpack plugin). Rationale: the web
  product is the launch; the shells were unmaintained wrappers whose
  package id was `org.mozilla.firefoxsend`. If native apps return,
  they'd be rebuilt as thin wrappers around the web app. The PWA
  manifest and its android-chrome icons remain (they're web assets).
- LICENSE and all MPL/copyright headers intact. The independence note
  ("SendSmith is an independent relaunch based on Mozilla's archived
  Firefox Send source (MPL-2.0). Not affiliated with Mozilla.") is in
  the README, the new `NOTICE` file, and the **app footer** (with a
  Report abuse link). Upstream README preserved as
  `UPSTREAM_README.md`.

## Phase 3 — Abuse gating

- **Rate limiting** (`server/middleware/ratelimit.js`): Redis
  fixed-window counters per IP, applied to WebSocket upload-init,
  download/token/blob routes, holder + public report routes, and auth
  routes. Env-configurable (`RATELIMIT_*`), defaults 30 uploads/h,
  600 downloads/h, 10 reports/day, 30 auth attempts/h. Over-limit →
  HTTP 429 + `Retry-After`. Redis failure → fail-open (limiting must
  never take the service down).
- **Anonymous defaults tightened**: 200 MB max file (was 1 GB
  Mozilla-era default... the account tier keeps **2.5 GB / 7 days /
  100 downloads**), ≤ 24 h TTL, ≤ 5 downloads, wired through the
  existing tier seam in `server/routes/ws.js`. Also fixed there: the
  size limiter's `Error('limit')` now correctly maps to **413**
  (upstream compared against a bare string and returned 500).
- **Bot gate**: Cloudflare Turnstile verified server-side on signup
  and upload-init (`server/middleware/botgate.js`), enabled only when
  both `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET` are set; the widget
  renders in the auth dialog when a site key is configured; CSP
  allowances are added only when enabled.
- **Public abuse report**: `GET /report-abuse` page +
  `POST /api/public-report` accepting a file id or full link URL +
  reason. It **flags** (`pubflag` on the metadata + an entry in the
  `public_reports` Redis list) and never deletes. The existing
  HMAC holder report still kills instantly — and `routes/report.js`
  now *awaits* the kill (upstream fired it un-awaited; against real
  Redis + S3 the link could still be alive when the 200 landed —
  observed, then fixed).
- **Admin takedown**: `scripts/admin-takedown.js` (`<id>`,
  `--list-reports`, `--restore`) + procedure in `docs/abuse.md`,
  including raw redis-cli equivalents (metadata is a hash keyed by
  file id; blob key is `<prefix>-<id>`).
- **Headers**: helmet 8 defaults + the app's CSP (Sentry/Turnstile
  sources added only when configured); homepage and download flows
  verified against the CSP in the e2e/feature runs.

## Phase 4 — Accounts + payments seam

- **Own auth replaces FxA** (`server/users.js`, `server/routes/auth.js`):
  email + password with **scrypt** hashing (self-describing
  `scrypt$N$r$p$salt$hash` format, timing-safe compare), opaque
  session tokens in Redis delivered as **httpOnly, SameSite=Lax
  cookies** (Secure in production), 30-day sessions. `server/fxa.js`,
  the `/oauth` route, all `fxa_*` config, and the browser FxA client
  are deleted. The app runs fully standalone.
- Frontend: `app/auth.js` (all account traffic through one API-layer
  module), `app/user.js` rewritten on the session API, and a new
  `app/ui/authDialog.js` — the previously handler-less `signup-cta`
  events (emitted by four UI components, handled by nothing) now open
  a working login/signup dialog. **Trade-off, stated plainly:** the
  encrypted file-list key used to arrive via the FxA scoped-keys
  bundle; it is now generated locally and kept in browser storage, so
  the synced file list is per-browser instead of per-account. The
  server still sees only ciphertext.
- **Tier seam**: the upload route keys size/TTL/download limits on the
  verified session (the slot FxA's "verified user" occupied). A
  **monthly transfer quota** per user lives in Redis (free 2 GiB,
  Pro 200 GiB, both env-configurable, 0 = unlimited), checked at
  upload start and incremented by actual bytes stored;
  `/api/auth/me` reports `usageBytes`/`quotaBytes`.
- **Stripe seam** (`server/billing.js`, `server/routes/billing.js`):
  Checkout session creation, customer portal, and a webhook
  (raw-body mounted before the JSON parser) that flips tier on
  `checkout.session.completed` and back on
  `customer.subscription.deleted`, linking customers to users. With
  any of `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID`/`STRIPE_WEBHOOK_SECRET`
  missing, the routes return 404 and the UI hides the feature
  (verified live). No keys, no charges, no Stripe account touched.
- Anonymous/free experience unchanged apart from the Phase 3 limits.

## Phase 5 — Production shape + verification

- **Real Redis**: couldn't install via apt in a persistent way (the VM
  discards system changes outside ~/workspace), so Redis **7.4.2 was
  built from the official source tarball** into `~/workspace/redis-build`
  and run locally. Caught three bugs the mock had hidden — most
  importantly `hmGet` misspelled as `hMGet` in the v5 facade, which
  would have broken metadata reads (the download path) against *any*
  real Redis. Production mode refuses redis-mock at startup
  (`server/validateConfig.js` also fails fast on: no storage backend,
  localhost `BASE_URL` in production, half-configured Turnstile or
  Stripe).
- **S3**: MinIO binaries are no longer downloadable (the project has
  been archived upstream and its mirrors return stubs), so the live
  test used **s3rver** (an S3-compatible test server) at
  `~/workspace/s3test`: the v3 code path — multipart `Upload`,
  streaming `GetObject`, `HeadObject`, `DeleteObject`, path-style
  endpoint — passed the full e2e suite against it (twice).
- **Dockerfile**: Node 22 multi-stage (builder compiles, final image
  production deps only, non-root user, `/app/data` volume).
  **docker-compose.yml**: app + Redis 7 (AOF persistence); the
  selenium service is gone. **`.env.example`** documents **every**
  config key (52), including storage, Redis, Turnstile, Stripe, and
  Sentry-off-by-default.
- Boot smoke: `/__lbheartbeat__` + `/__heartbeat__` 200,
  `/__version__` reports the build commit, homepage `<title>` is
  **SendSmith**. Dev workflow intact: `npm start` serves the app on
  :1337 (WS backend :1338) with the SendSmith title.

### Verification matrix (all numbers are runs, not intentions)

| Check | Node 22.21.1 | Node 24.20.0 |
|---|---|---|
| `npm ci` clean | ✅ 1,271 pkgs (1,269 via ci on 24) | ✅ |
| `npm run build` (no legacy provider) | ✅ webpack 5, 3 perf warnings only | ✅ |
| Backend tests | ✅ **63/63** (48 upstream + 8 crypto golden vectors + 4 users + 3 rate-limit) | ✅ 63/63 |
| Boot + heartbeats + branding | ✅ | ✅ |
| e2e-client (protocol suite) | ✅ **11/11** — redis-mock+FS, real Redis+FS, real Redis+S3 (×2) | ✅ 11/11 (real Redis+FS) |
| Feature suite `scripts/verify-features.js` | ✅ **19/19** (real Redis) | ✅ 19/19 (real Redis) |

Feature suite covers: signup 201 + httpOnly cookie, duplicate 409,
weak password 400, wrong-password 401, `/api/auth/me` shape, billing
404-when-unconfigured, public report flags **without** killing
(exists stays 200) and lands in the admin queue, report rate limit
429, logout invalidates the session, anon 1 KB cap → **413** while an
account upload of the same file succeeds, quota counter increments
(4,134 bytes recorded for a 4 KB upload), upload rate limit 429.
Admin tooling was exercised by hand against the live Redis
(list-reports, --restore clears the flag, takedown sets `dead=1`).

**Lint status (honest):** eslint now runs (the security plugin was
pinned to its eslintrc-compatible 1.x line); 3 errors remain, all
pre-existing upstream code (a dynamic-import parse quirk in
`app/capabilities.js`, a setter return in `app/storage.js`, the
`TransformStream` global shim in `app/streams.js`) plus warnings.
stylelint runs with 21 pre-existing style errors in the legacy CSS
under the modern standard config. Neither is wired into CI; both are
documented here rather than silently "fixed" by rewriting upstream
code wholesale.

## Future-proofing (Ray's directive)

1. **Runtime headroom** — `engines: ">=20 <25"`, `.nvmrc` = 22, and
   the *entire* matrix above was run on Node 24 as well as 22 (both
   green). CI (`.github/workflows/ci.yml`) tests [22, 24] on every
   push/PR: install, build, backend tests, boot smoke, e2e.
   Dependencies pinned to dead stacks were eliminated (mozlog,
   express-ws/`esm`, aws-sdk v2, node-fetch 2); where a library was
   the risk, we now own a thin module instead (logging facade,
   ws wiring, version plugin).
2. **Standards over frameworks** — native `fetch`,
   `crypto.hkdfSync`/WebCrypto, the standard S3 API (never AWS-locked:
   endpoint + path-style are config), the standard Redis protocol.
   The choo frontend is isolated: all server communication flows
   through `app/api.js`, `app/auth.js`, `app/fileSender.js`, so a
   frontend swap never touches the backend. No new niche dependencies
   were added (path-browserify is the only new one, a webpack
   requirement for an existing package).
3. **Crypto golden vectors** — `test/backend/crypto-vectors-tests.js`
   freezes HKDF (auth + metadata keys), the send-v1 HMAC nonce
   signature, an ECE ciphertext (encrypt *and* decrypt directions),
   the encrypted-metadata blob, and the PBKDF2 password path, each
   cross-checked by two independent implementations. `docs/FORMAT.md`
   specifies the v1 format byte-for-byte and the versioning rules
   (a format break = new scheme name + new vectors; the v1 vectors
   are never "updated" to match new output). Regeneration script:
   `scripts/generate-crypto-vectors.js`. A 2028 client implementing
   FORMAT.md + passing these vectors decrypts a 2026 link.
4. **Update automation** — `.github/dependabot.yml` (weekly npm +
   Docker + Actions, grouped for aws-sdk/Fluent/Sentry) and the CI
   workflow above ship in the repo, ready for the day it has a remote.
5. **Config & portability** — everything environment-specific is an
   env var; startup validation fails fast with a named problem;
   storage sits behind the existing `server/storage` interface;
   `docs/UPGRADING.md` documents the Node LTS checklist, the
   dependency-bump procedure, Redis/S3 swap notes, and the MPL
   release checklist.
6. **Observability without lock-in** — pino JSON logs; Mozilla's
   heartbeat/version endpoints kept; Sentry is env-opt-in for the
   operator's *own* instance only; Amplitude/GA keys default empty
   (no third-party telemetry calls when unset).

**Accepted longevity risks, named plainly:**

- **choo 6 / nanohtml frontend** — old but small and stable; the
  isolation above caps the blast radius of an eventual rewrite.
- **express 4 + the app's hand-rolled middleware stack** — express 5
  exists; the upgrade wasn't needed for Node 22/24 and touches every
  route's assumptions, so it's a deliberate future project (the
  UPGRADING.md procedure covers how).
- **Tailwind v3** (v4 is current) — a CSS-toolchain migration was
  riskier than the v1→v3 jump already done; theme is config-driven,
  utilities verified present in the built CSS.
- **eslint 8 / stylelint 16** — pinned to the last eslintrc-era
  majors for config compatibility; migrating to flat config is
  future maintenance, noted in UPGRADING.md.
- **File-list sync is per-browser** (see Phase 4 trade-off).

## Honest disclosures

- $0 revenue; no users; never deployed. Stripe/Turnstile code paths
  are seams verified for graceful absence and (for auth/report/limits)
  live behavior — the Stripe happy path cannot be exercised without
  Ray's account keys, by design.
- The legacy frontend test harness (`test/frontend/`, webdriver
  configs, `server/bin/test.js`) is retained for provenance but is
  **not** part of `npm test` and does not run; UPGRADING.md says what
  reviving it takes. The dev-server test bundle shows compile errors
  from that harness only — the app bundle is clean.
- Upstream Mozilla-era docs remain under `docs/` as historical record;
  canonical docs are the README, FORMAT.md, abuse.md, UPGRADING.md,
  and this report.
- Verification tooling left in the workspace (outside the repo):
  `~/workspace/redis-build` (Redis 7.4.2 binaries),
  `~/workspace/s3test` (s3rver + OSV sampler).

## Remaining launch blockers — decisions/inputs needed from Ray

1. **Hosting/VPS choice** (any Docker-capable host works with the
   shipped compose file).
2. **Domain or subdomain** for the service (sets `BASE_URL`).
3. **Blob storage**: an R2/S3/B2 bucket + credentials (or accept
   single-host `FILE_DIR` on a persistent volume to start).
4. **Redis hosting**: compose provides one; a managed Redis works too.
5. **Turnstile site/secret keys** (free Cloudflare account) if the bot
   gate should be on at launch — recommended.
6. **Stripe account keys + Pro price** (`STRIPE_SECRET_KEY`,
   `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`) to turn on Pro.
7. **Abuse contact email** to publish on /report-abuse (the page text
   has a placeholder until then), plus your own Terms/Privacy text —
   the upstream legal pages were Mozilla's and were removed, not
   replaced.
8. A GitHub repo, if/when you want the shipped CI + Dependabot to
   actually run (this build was kept local-only per instructions).
