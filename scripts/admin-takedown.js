#!/usr/bin/env node
/*
 * SendSmith admin takedown tool.
 *
 * Usage:
 *   node scripts/admin-takedown.js <file-id> [--restore]
 *   node scripts/admin-takedown.js --list-reports
 *
 * --list-reports prints the public abuse reports queue
 * (see server/routes/publicReport.js and docs/abuse.md).
 *
 * A takedown marks the file dead and deletes its blob, exactly like
 * the built-in holder report. --restore only clears the public-report
 * flag; it cannot undelete a file that was taken down.
 *
 * Uses the app's own config (REDIS_HOST, storage backend, ...) —
 * run it in the same environment as the server.
 */

async function main() {
  const args = process.argv.slice(2);
  const storage = require('../server/storage');

  if (args.includes('--list-reports')) {
    const reports = storage.redis.lrangeAsync
      ? await storage.redis.lrangeAsync('public_reports', 0, 99)
      : [];
    if (!reports.length) {
      console.log('No public reports in the queue.');
    }
    for (const entry of reports) {
      console.log(entry);
    }
    process.exit(0);
  }

  const id = args.find(a => !a.startsWith('--'));
  if (!id || !/^[0-9a-fA-F]{10,16}$/.test(id)) {
    console.error(
      'Usage: node scripts/admin-takedown.js <file-id> [--restore]\n' +
        '       node scripts/admin-takedown.js --list-reports'
    );
    process.exit(2);
  }

  const meta = await storage.metadata(id);
  if (!meta) {
    console.log(`No such file: ${id}`);
    process.exit(1);
  }

  if (args.includes('--restore')) {
    await storage.redis.hsetAsync(id, 'pubflag', '');
    console.log(`Cleared public-report flag on ${id} (file unchanged).`);
    process.exit(0);
  }

  await storage.kill(id);
  console.log(
    `Took down ${id} (owner ${meta.owner}, downloads ${meta.dl}/${meta.dlimit}).`
  );
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
