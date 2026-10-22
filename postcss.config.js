const options = {
  plugins: [
    require('tailwindcss')('./tailwind.config.js'),
    require('postcss-preset-env')
  ]
};

if (process.env.NODE_ENV === 'development') {
  options.map = { inline: true };
} else {
  // Tailwind v3 prunes unused utilities itself via its `content` config,
  // so the old external purgecss step is gone. cssnano still minifies.
  options.plugins.push(
    require('cssnano')({
      preset: 'default'
    })
  );
}

module.exports = options;
