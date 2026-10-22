# Upgrading & Maintenance Runbook

How to keep SendSmith alive for years: runtime upgrades, dependency
bumps, infrastructure swaps, and the MPL compliance checklist. The
design rules that make this cheap are in BUILD_REPORT.md
("Future-proofing"); this file is the procedure.

## Node LTS upgrade checklist

SendSmith targets the current Node LTS (22 at launch) with
`engines: ">=20 <25"`. When a new LTS lands:

1. Install the new runtime next to the old one; do not overwrite.
2. `rm -rf node_modules package-lock.json` is **not** required — run
   `npm ci` first; only regenerate the lockfile if `npm ci` fails on
   the new runtime (native modules are the usual cause; this codebase
   currently has none in the production path).
3. Run the full gate on the new runtime:
   - `npm ci`
   - `npm run build` (webpack must pass **without**
     `--openssl-legacy-provider`; needing it means a dependency
     regressed to md4 hashing — fix the dependency, not the flags)
   - `npm run test:backend` (includes the crypto golden vectors —
     see FORMAT.md; a failure there is a format break, stop)
   - boot smoke: `FILE_DIR=./data node server/bin/prod.js`, then
     `curl localhost:1443/__heartbeat__` and `curl localhost:1443/__lbheartbeat__`
   - `npm run test:e2e` against the booted server
4. Update `.nvmrc`, the Dockerfile base image, and the CI matrix
   (`.github/workflows/ci.yml`) to the new LTS pair (current + next).
5. Widen `engines` deliberately — never let it silently include an
   EOL runtime.

## Dependency-bump procedure

- Dependabot (`.github/dependabot.yml`) opens weekly npm, Docker, and
  Actions updates. Merge rules:
  - Patch/minor: CI green on both Node versions is sufficient.
  - Major: read the changelog for removed Node APIs, changed defaults
    (helmet/CSP and convict formats have bitten before), and anything
    touching crypto, Redis commands, or the S3 API — those get a local
    e2e run, not just CI.
- Never pin a dependency whose maintainer has abandoned it when a
  maintained successor exists; the two cautionary tales are in this
  repo's history (mozlog/intel, express-ws + the `esm` loader). Prefer
  platform APIs (native `fetch`, `crypto.hkdfSync`, WebCrypto) over
  new dependencies.
- The frontend framework (choo) is deliberately isolated: all server
  communication goes through `app/api.js`, `app/auth.js`, and
  `app/fileSender.js`. A future frontend rewrite touches only those
  consumers.

## Redis swap notes

- Metadata, sessions, rate limits, quotas, and file lists all live in
  Redis behind `server/storage/redis.js`, which exposes an
  `*Async`-suffixed facade over the official `redis` client.
- Any Redis-protocol store works (self-hosted Redis, Upstash,
  ElastiCache, Dragonfly, KeyDB…): set `REDIS_HOST` / `REDIS_PORT` /
  `REDIS_PASSWORD`. The server refuses `redis-mock` in production
  (see `server/validateConfig.js`) — the mock is test-only.
- Redis holds **everything stateful**: file metadata, accounts,
  sessions, quotas, rate limits. Losing it loses live links *and*
  accounts. Enable RDB/AOF persistence on the Redis instance (the
  docker-compose example does); blob-store ciphertext is orphaned
  without its Redis metadata.

## S3 swap notes

- Blob storage sits behind `server/storage/index.js` with three
  implementations: `s3.js` (AWS SDK v3, standard S3 API — works with
  AWS S3, Cloudflare R2, Backblaze B2, MinIO via `S3_ENDPOINT` +
  `S3_FORCE_PATH_STYLE` + `S3_REGION`), `gcs.js` (Google Cloud
  Storage), and `fs.js` (local disk, single-host only).
- Switching providers needs no code change: set the env vars, copy the
  bucket contents preserving object keys (keys are the file ids), done.
- The filesystem backend is the fallback when no bucket is configured;
  `FILE_DIR` must be persistent storage in that mode.

## MPL-2.0 compliance checklist (per release)

SendSmith is built on Mozilla's Firefox Send source (MPL-2.0). Before
any public release/distribution:

- [ ] `LICENSE` (MPL-2.0) and all upstream copyright/license headers
      in modified files are intact.
- [ ] Modified MPL-covered files carry a change notice (git history
      serves this; the import commit is labeled as the pristine
      upstream import, upstream HEAD ade10e4).
- [ ] Source for the MPL-covered portions is available to recipients
      (public repo or source offer in the product's About/legal page).
- [ ] New files written for SendSmith (accounts, billing, abuse,
      logging, ws wiring) may be under terms of our choosing; they are
      marked "New SendSmith code" in their headers where applicable.
- [ ] No Mozilla/Firefox trademarks are used: no Firefox logo, no
      "Firefox Send" name, no Mozilla endorsement implied. The About
      note reads: "SendSmith is an independent relaunch based on
      Mozilla's archived Firefox Send source (MPL-2.0). Not affiliated
      with Mozilla."
- [ ] Third-party notices in bundled output (webpack
      `*.LICENSE.txt` files) are shipped as generated.

## Known deferred maintenance

- The legacy frontend test harness (`test/frontend/`, mocha +
  testpilot-ga stubs) is retained for reference but is not wired into
  `npm test`; reviving it means re-pointing `server/bin/test.js` at
  `server/wsServer.js`.
- `docs/` still contains Mozilla-era documents (deployment, metrics,
  experiments) kept as historical record of the upstream project.
  Canonical SendSmith docs: README.md, docs/FORMAT.md, docs/abuse.md,
  this file, and BUILD_REPORT.md.
