# SendSmith

**Send it. Gone.** — encrypted file transfer that self-destructs.

SendSmith is a private file-sharing service: files are encrypted in
your browser with a key that never leaves your device, shared via a
link that automatically expires after a set number of downloads or a
set time. The server stores only ciphertext and cannot read what you
send.

> **Provenance:** SendSmith is an independent relaunch based on
> Mozilla's archived Firefox Send source code (MPL-2.0). **Not
> affiliated with Mozilla.** See [NOTICE](NOTICE) and
> [docs/UPGRADING.md](docs/UPGRADING.md) for the MPL compliance
> checklist. The upstream README is preserved as
> [UPSTREAM_README.md](UPSTREAM_README.md).

## Features

- End-to-end encrypted transfers (ECE / RFC 8188 `aes128gcm`), format
  documented in [docs/FORMAT.md](docs/FORMAT.md) and locked by golden
  test vectors — links stay decryptable across future upgrades.
- Self-destructing links: TTL + download-count limits.
- Optional password protection on links.
- Anonymous sending (200 MB / 24 h / 5 downloads by default) and
  optional accounts with higher limits and monthly quotas; a paid
  **Pro** tier via Stripe when configured.
- Abuse controls: per-IP rate limits, optional Cloudflare Turnstile,
  public abuse reporting with human-review takedown
  ([docs/abuse.md](docs/abuse.md)). Zero-knowledge by design — content
  scanning is impossible, and the docs say so plainly.

## Quick start (development)

Requires Node.js 20–24 (22 LTS recommended; see `.nvmrc`) and npm.

```bash
npm ci
npm run build
FILE_DIR=./data node server/bin/prod.js
# → http://localhost:1443 (heartbeats at /__heartbeat__, /__lbheartbeat__)
```

Development uses an in-memory Redis mock and local file storage —
fine for hacking, **not** for production (production mode refuses the
mock; see `server/validateConfig.js`).

Tests:

```bash
npm run test:backend   # unit + golden-vector tests
npm run test:e2e       # protocol e2e against a running server
```

Hot-reload dev server: `npm run dev` (webpack-dev-server, port 8080 +
WebSocket backend on 1338).

## Production

```bash
cp .env.example .env   # set BASE_URL, storage, secrets
docker compose up -d   # app + Redis with persistence
```

Or run directly: `NODE_ENV=production` with a real Redis
(`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`) and either an
S3-compatible bucket (`S3_BUCKET`, `S3_ENDPOINT` for R2/B2/MinIO,
`S3_USE_PATH_STYLE_ENDPOINT`), a GCS bucket (`GCS_BUCKET`), or a
persistent `FILE_DIR`. Every setting is an environment variable —
[.env.example](.env.example) lists them all. Optional integrations
(Turnstile, Stripe, Sentry) are **off unless fully configured**.

## Upgrades & maintenance

[docs/UPGRADING.md](docs/UPGRADING.md) is the runbook: Node LTS
checklist, dependency-bump procedure, Redis/S3 swap notes, MPL
checklist. Dependabot + CI configs ship in `.github/`.

## License

Mozilla Public License 2.0 — see [LICENSE](LICENSE). Upstream
copyright notices are preserved throughout; new SendSmith code is
marked as such in file headers.
