const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/ui/app.tsx'],
  bundle: true,
  outfile: 'public/js/bundle.js',
  minify: true,
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  loader: {
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.svg': 'text'
  }
}).then(() => {
  console.log('✅ UI bundle created successfully at public/js/bundle.js');
}).catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
