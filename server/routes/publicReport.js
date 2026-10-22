/*
 * SendSmith public abuse reporting.
 *
 * Unlike the holder report (POST /api/report/:id, which requires the
 * link's HMAC and instantly kills the file), this path is for people
 * who do NOT hold a link secret — e.g. a rightsholder or a recipient
 * of a phishing link. A public report FLAGS the file for operator
 * review and writes an entry to the `public_reports` Redis list; it
 * never kills a file by itself. Operators review and take down with
 * scripts/admin-takedown.js (see docs/abuse.md).
 *
 * New SendSmith code.
 */
const storage = require('../storage');
const log = require('../log')('send.publicreport');

const REASONS = ['Malware', 'PII', 'Abuse', 'Copyright', 'Other'];
const ID_PATTERN = /([0-9a-fA-F]{10,16})/;

function extractId(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }
  const match = input.match(ID_PATTERN);
  return match ? match[1] : null;
}

module.exports = {
  async submit(req, res) {
    try {
      const body = req.body || {};
      const id = extractId(body.id || body.url);
      const reason = REASONS.includes(body.reason) ? body.reason : 'Other';
      if (!id) {
        return res.status(400).json({ error: 'invalid_id' });
      }
      const meta = await storage.metadata(id);
      if (meta) {
        const record = {
          id,
          reason,
          details: String(body.details || '').slice(0, 1000),
          ip: req.ip,
          at: new Date().toISOString()
        };
        // Informational field only — storage.get() checks `dead` and
        // `flagged`, never `pubflag`, so the file stays up until an
        // operator reviews the report.
        storage.setField(id, 'pubflag', record.at);
        await storage.redis.lpushAsync(
          'public_reports',
          JSON.stringify(record)
        );
        log.warn('public abuse report', record);
      }
      // Always 200 for well-formed reports, whether or not the file
      // exists, so the endpoint can't be used to enumerate live ids.
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'internal' });
    }
  },

  page(req, res) {
    const nonce = req.cspNonce ? ` nonce="${req.cspNonce}"` : '';
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Report abuse — SendSmith</title>
<style>
  body { font-family: system-ui, sans-serif; background:#171310; color:#f3ece6; margin:0; }
  main { max-width: 34rem; margin: 8vh auto; padding: 2rem; background:#241d18; border-radius: 12px; }
  h1 { font-size: 1.4rem; } label { display:block; margin: 1rem 0 .3rem; }
  input, select, textarea { width: 100%; padding: .6rem; border-radius: 6px; border: 1px solid #4a3f35; background:#171310; color: inherit; box-sizing: border-box; }
  button { margin-top: 1.2rem; background:#ff7a1a; color:#171310; font-weight: 700; border: 0; padding: .7rem 1.4rem; border-radius: 6px; cursor: pointer; }
  .ok { color: #8be09a; } .err { color: #ff9a8a; }
</style>
</head>
<body>
<main>
  <h1>Report abuse</h1>
  <p>If a SendSmith link was used for malware, phishing, personal data
  exposure or copyright infringement, tell us here. Reports are reviewed
  by a human; reporting a link does not delete it automatically.</p>
  <form id="f">
    <label for="url">SendSmith link or file ID</label>
    <input id="url" name="url" required placeholder="https://…/download/0123abcd…" />
    <label for="reason">Reason</label>
    <select id="reason" name="reason">
      ${REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
    </select>
    <label for="details">Details (optional)</label>
    <textarea id="details" name="details" rows="4" maxlength="1000"></textarea>
    <button type="submit">Submit report</button>
    <p id="msg" role="status"></p>
  </form>
</main>
<script${nonce}>
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msg');
    const body = {
      url: document.getElementById('url').value,
      reason: document.getElementById('reason').value,
      details: document.getElementById('details').value
    };
    try {
      const res = await fetch('/api/public-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        msg.textContent = 'Report received. Thank you — it will be reviewed.';
        msg.className = 'ok';
        e.target.reset();
      } else {
        msg.textContent = 'That link or ID did not parse. Check it and try again.';
        msg.className = 'err';
      }
    } catch (err) {
      msg.textContent = 'Submission failed. Please try again later.';
      msg.className = 'err';
    }
  });
</script>
</body>
</html>`);
  }
};
