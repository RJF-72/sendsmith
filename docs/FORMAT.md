# SendSmith File Format — Version 1 ("send-v1")

This document describes the exact wire and encryption format SendSmith
uses, inherited unchanged from Firefox Send v3. It is the contract the
golden-vector tests (`test/backend/crypto-vectors-tests.js`) enforce:
any implementation that reproduces those vectors byte-for-byte can
decrypt any file this build produces, and vice versa. A share link from
2026 must still open in a client built years later.

## 1. Keys

- The **file secret** is 16 random bytes, generated in the sender's
  browser. It travels only in the URL fragment (`#<base64url>`) of the
  share link and is never sent to the server.
- All other keys are derived from the secret with **HKDF-SHA-256**
  (RFC 5869), with an **empty salt** (equivalently: a 32-byte all-zero
  salt in the extract step) and these `info` strings:
  - `authentication` → 32-byte **auth key** (HMAC key, see §3).
  - `metadata` → 16-byte **metadata key** (AES-128-GCM, see §4).

## 2. File encryption — ECE (RFC 8188, `aes128gcm`)

- Plaintext is encrypted with the `aes128gcm` encrypted-content-encoding:
  - Record size `rs = 65536` (64 KiB).
  - Per-file random 16-byte **salt**, stored in the header.
  - Content key: `HKDF(secret, salt, "Content-Encoding: aes128gcm\0", 16)`
    (note the trailing NUL in the info string).
  - Nonce base: `HKDF(secret, salt, "Content-Encoding: nonce\0", 12)`;
    each record's nonce is the base with its last 32 bits XORed by the
    record sequence number (starting at 0).
  - Each record is `AES-128-GCM(key, nonce)` over
    `chunk || delimiter || zero-padding to rs-16 bytes`, where the
    delimiter is `0x01` for non-final records and `0x02` for the final
    record; the 16-byte GCM tag is appended to each record.
  - Wire layout: `salt(16) || rs(uint32 BE) || idlen(1 = 0) || records…`.
- Encryption happens client-side, streaming; the server stores and
  serves only ciphertext.

## 3. Authentication — "send-v1" HMAC

- The server stores, per file: a random **owner token** (returned to
  the uploader) and a **nonce** (rotated after every authenticated
  request, delivered in the `WWW-Authenticate: send-v1 <nonce>`
  response header).
- A client proves possession of the secret for metadata/download
  requests by sending `Authorization: send-v1 <base64 sig>` where
  `sig = HMAC-SHA-256(authKey, nonce-bytes)`.
- Download access tokens: `GET /api/download/token/:id` (send-v1 auth)
  returns a bearer token authorizing `GET /api/download/:id` and
  `POST /api/download/done/:id`.
- The link **holder report** (`POST /api/report/:id`, send-v1 auth)
  deletes the file immediately. (The separate *public* report path
  flags without deleting — see docs/abuse.md.)

## 4. Encrypted metadata

- JSON: `{ name, size, type, manifest }`, UTF-8.
- Encrypted with the **metadata key**, AES-128-GCM, **all-zero 12-byte
  IV**, tag appended. Stored server-side as an opaque blob; the server
  cannot read file names or sizes of the plaintext.

## 5. Password-protected links (optional)

- If the sender sets a password, the auth key is replaced by:
  `PBKDF2-HMAC-SHA-256(password, salt = share URL string, 100 iterations)`
  whose output keys the same HKDF/auth construction. The server only
  learns that a password is required, never the password.

## 6. Upload transport

- `WebSocket /api/ws`: first message is JSON
  `{ fileMetadata, authorization: "send-v1 <authKey base64>", timeLimit, dlimit, password?, bearer? }`;
  the server replies `{ url, ownerToken, id }`; the client then streams
  the ciphertext as binary messages followed by a single `0x00` byte
  (EOF). The server enforces size/TTL/download limits and the monthly
  quota by tier, and stores `{ encrypted metadata, owner hash, nonce,
  expiry, download count }` in Redis (hash, TTL-bound) plus the
  ciphertext in the blob store.

## 7. Versioning

- The format version is **1**. There is no version field on the wire —
  the `send-v1` scheme name *is* the version marker.
- Rules for future changes:
  1. Any change that alters any byte in §§1–5 is a **format break**.
  2. A format break requires a new scheme name (`send-v2`), a new
     section in this document, and readers that support v1 for as long
     as v1 links may be live (max TTL is 7 days, so overlap is cheap).
  3. The golden vectors in `test/backend/crypto-vectors-tests.js` are
     never edited to match new output; new vectors are *added* for the
     new version.
  4. `scripts/generate-crypto-vectors.js` regenerates the v1 vectors
     for auditing.
