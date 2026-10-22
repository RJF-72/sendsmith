const fs = require('fs');
const path = require('path');
const { FluentBundle, FluentResource } = require('@fluent/bundle');
const localesPath = path.resolve(__dirname, '../public/locales');
const locales = fs.readdirSync(localesPath);

function makeBundle(locale) {
  const bundle = new FluentBundle(locale, { useIsolating: false });
  bundle.addResource(
    new FluentResource(
      fs.readFileSync(path.resolve(localesPath, locale, 'send.ftl'), 'utf8')
    )
  );
  return [locale, bundle];
}

const bundles = new Map(locales.map(makeBundle));

function format(bundle, id, data) {
  const msg = bundle.getMessage(id);
  if (msg && msg.value) {
    return bundle.formatPattern(msg.value, data);
  }
  return null;
}

module.exports = function getTranslator(locale) {
  const defaultBundle = bundles.get('en-US');
  const bundle = bundles.get(locale) || defaultBundle;
  return function(id, data) {
    const out = format(bundle, id, data);
    if (out !== null) {
      return out;
    }
    const fallback = format(defaultBundle, id, data);
    // Unknown message ids render as the id itself instead of throwing,
    // so a missing string can never take a page down.
    return fallback !== null ? fallback : id;
  };
};
