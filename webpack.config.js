const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const { WebpackManifestPlugin } = require('webpack-manifest-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const VersionPlugin = require('./build/version_plugin');

const webJsOptions = {
  babelrc: false,
  presets: [
    [
      '@babel/preset-env',
      {
        bugfixes: true,
        useBuiltIns: 'entry',
        corejs: 3
      }
    ]
  ],
  plugins: [
    '@babel/plugin-syntax-dynamic-import',
    'module:nanohtml',
    ['@babel/plugin-transform-class-properties', { loose: false }]
  ]
};

// Webpack 5 asset modules replace file-loader. SVGs are emitted as-is
// (the old svgo-loader minification step was dropped with webpack 4).
const assetRule = {
  test: /\.(png|jpg|svg)$/,
  type: 'asset/resource',
  generator: {
    filename: '[name].[contenthash:8][ext]'
  }
};

const assetMapRule = {
  // loads all assets from assets/ for use by common/assets.js
  test: require.resolve('./common/generate_asset_map.js'),
  use: ['babel-loader', 'val-loader']
};

// webpack 5 no longer polyfills Node core modules for the browser.
// `content-disposition` (used by the download code) requires `path`;
// path-browserify is the maintained stand-in.
const nodeFallbacks = {
  resolve: {
    fallback: {
      path: require.resolve('path-browserify')
    }
  }
};

const serviceWorker = {
  target: 'webworker',
  ...nodeFallbacks,
  entry: {
    serviceWorker: './app/serviceWorker.js'
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/'
  },
  devtool: 'source-map',
  module: {
    rules: [assetRule, assetMapRule]
  },
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^\.\.\/dist/ })
  ]
};

const web = {
  target: 'web',
  ...nodeFallbacks,
  entry: {
    app: ['./app/main.js']
  },
  output: {
    chunkFilename: '[name].[contenthash:8].js',
    filename: '[name].[contenthash:8].js',
    path: path.resolve(__dirname, 'dist')
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: 'babel-loader',
        include: [
          path.resolve(__dirname, 'app'),
          path.resolve(__dirname, 'common'),
          // some dependencies need to get re-babeled because we
          // have different targets than their default configs
          path.resolve(
            __dirname,
            'node_modules/@dannycoates/webcrypto-liner'
          ),
          path.resolve(__dirname, 'node_modules/@fluent')
        ],
        options: webJsOptions
      },
      assetRule,
      {
        // creates style.css with all styles
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              importLoaders: 1
            }
          },
          'postcss-loader'
        ]
      },
      {
        test: /\.ftl$/,
        use: 'raw-loader'
      },
      {
        // creates test.js for /test
        test: require.resolve('./test/frontend/index.js'),
        use: ['babel-loader', 'val-loader']
      },
      assetMapRule
    ]
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          context: 'public',
          from: '*.*'
        }
      ]
    }),
    new webpack.EnvironmentPlugin(['NODE_ENV']),
    new webpack.IgnorePlugin({ resourceRegExp: /^\.\.\/dist/ }), // used in common/*.js
    new MiniCssExtractPlugin({
      filename: '[name].[contenthash:8].css'
    }),
    new VersionPlugin(), // used for the /__version__ route
    // used by server side to resolve hashed assets. publicPath '' keeps
    // manifest values as bare filenames like the v2 plugin produced —
    // webpack 5's default 'auto' publicPath would leak an "auto/"
    // prefix into them and the server would 404 every asset.
    new WebpackManifestPlugin({ publicPath: '' })
  ],
  devtool: 'source-map',
  devServer: {
    setupMiddlewares: (middlewares, devServer) => {
      if (process.env.NODE_ENV === 'development') {
        require('./server/bin/dev')(devServer.app, devServer);
      }
      return middlewares;
    },
    compress: true,
    hot: false,
    host: '0.0.0.0',
    proxy: [
      {
        context: ['/api/ws'],
        target: 'ws://localhost:1338',
        ws: true,
        secure: false
      }
    ]
  }
};

module.exports = (env, argv) => {
  const mode = argv.mode || 'production';
  // eslint-disable-next-line no-console
  console.error(`mode: ${mode}`);
  process.env.NODE_ENV = web.mode = serviceWorker.mode = mode;
  if (mode === 'development') {
    // istanbul instruments the source for code coverage
    webJsOptions.plugins.push('istanbul');
    web.entry.tests = ['./test/frontend/index.js'];
  }
  return [web, serviceWorker];
};
