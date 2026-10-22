const storage = require('../storage');
const { statReportEvent } = require('../amplitude');

module.exports = async function(req, res) {
  try {
    const id = req.params.id;
    const meta = await storage.metadata(id);
    // Awaited: upstream fired this off un-awaited, so the 200 could
    // reach the client before the kill landed in Redis/blob storage
    // (observed against real Redis + S3: exists still returned 200
    // immediately after a report). "Reported links die immediately"
    // is a safety property — it has to be true when we say it.
    await storage.flag(id);
    statReportEvent({
      id,
      ip: req.ip,
      country: req.geo.country,
      state: req.geo.state,
      owner: meta.owner,
      reason: req.body.reason,
      download_limit: meta.dlimit,
      download_count: meta.dl,
      agent: req.ua.browser.name || req.ua.ua.substring(0, 6)
    });
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(404);
  }
};
