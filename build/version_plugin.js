const { execSync } = require('child_process');
const webpack = require('webpack');
const pkg = require('../package.json');

// Internal replacement for the unmaintained `git-rev-sync` package:
// we only ever needed the short commit hash.
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', {
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .toString()
    .trim();
} catch (e) {
  console.warn('Error fetching current git commit: ' + e);
}

const version = JSON.stringify({
  commit,
  source: pkg.homepage || '',
  version: process.env.CIRCLE_TAG || `v${pkg.version}`
});

class VersionPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('VersionPlugin', compilation => {
      compilation.hooks.processAssets.tap(
        {
          name: 'VersionPlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          compilation.emitAsset(
            'version.json',
            new webpack.sources.RawSource(version)
          );
        }
      );
    });
  }
}

module.exports = VersionPlugin;
