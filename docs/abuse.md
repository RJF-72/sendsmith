# Abuse Handling

SendSmith is zero-knowledge by design: files are encrypted in the
sender's browser and the server cannot read content (docs/FORMAT.md).
Content scanning is therefore impossible — abuse handling is built on
limits, friction, reporting, and fast takedown instead.

## Preventive controls (all env-configurable, see .env.example)

- **Rate limits** (Redis fixed-window, per IP): uploads/hour
  (`RATELIMIT_UPLOAD_MAX`), downloads/hour (`RATELIMIT_DOWNLOAD_MAX`),
  reports/day (`RATELIMIT_REPORT_MAX`), auth attempts/hour
  (`RATELIMIT_AUTH_MAX`). Hitting a limit returns HTTP 429 with
  `Retry-After`. Verify with `scripts/verify-abuse-controls.sh` after
  deployment changes.
- **Anonymous tier limits**: max file size `ANON_MAX_FILE_SIZE`
  (default 200 MB), max TTL 24 h, max 5 downloads. Account (free) tier
  gets the standard limits; Pro gets the largest.
- **Bot gate (optional)**: Cloudflare Turnstile on signup and upload.
  Set `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET` to enable; unset =
  disabled. Never commit real keys.
- **Self-destruction**: every file expires by TTL and download count;
  nothing is permanent.
- **Security headers**: helmet defaults + the app's CSP (server/routes).

## Reporting paths

1. **Link holder** (has the secret): `POST /api/report/:id` with the
   send-v1 HMAC — the file is deleted immediately. This is the
   in-product "Report this file" flow on the download page.
2. **Public** (no secret): the `/report-abuse` page or
   `POST /api/public-report` with `{ id or url, reason }`. This
   **flags** the file (`pubflag` field on its metadata + an entry in
   the `public_reports` Redis list) — it does **not** delete anything
   on a single report, so the report path can't be used to censor
   links. A human reviews flags and takes down confirmed abuse.

## Takedown procedure

Review the queue:

```bash
node scripts/admin-takedown.js --list-reports
```

Take a file down (deletes blob + metadata, from any report source —
DMCA notices, court orders, law-enforcement requests, or a verified
public flag):

```bash
node scripts/admin-takedown.js <file-id>
```

Undo an erroneous takedown of a flagged-but-live file's flag
(the file itself is untouched by flagging):

```bash
node scripts/admin-takedown.js --restore <file-id>
```

Equivalent raw Redis operations, if the script is unavailable:

```bash
# file metadata is a Redis hash keyed by the file id itself
redis-cli HGETALL <file-id>
# list public reports
redis-cli LRANGE public_reports 0 -1
# hard takedown: read the storage prefix, delete metadata + blob
redis-cli HGET <file-id> prefix        # e.g. "1"
redis-cli DEL <file-id>
# then delete the blob named "<prefix>-<file-id>" from the bucket
# (or FILE_DIR directory)
```

## Operator commitments to make at launch

- Publish an abuse contact (e.g. abuse@<your-domain>) on the
  /report-abuse page and in the site footer; the page text has a
  placeholder until then.
- DMCA: the takedown command above executes a removal in seconds;
  document your designated-agent details in your own terms.
- Because content is unreadable to us, responses to reports are
  necessarily "the link is disabled", never content judgments.
