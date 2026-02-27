import { build, context } from 'esbuild'

const common = {
  bundle: true,
  sourcemap: true,
  target: 'chrome120',
  format: 'iife',
}

const entries = [
  { entryPoints: ['src/background.ts'], outfile: 'dist/background.js' },
  { entryPoints: ['src/content.ts'], outfile: 'dist/content.js' },
  { entryPoints: ['src/page.ts'], outfile: 'dist/page.js' },
  { entryPoints: ['src/ui.ts'], outfile: 'dist/ui.js' },
]

const isWatch = process.argv.includes('--watch')

if (isWatch) {
  for (const entry of entries) {
    const ctx = await context({ ...common, ...entry })
    await ctx.watch()
  }
  console.log('Watching for changes...')
} else {
  await Promise.all(entries.map(entry => build({ ...common, ...entry })))
  console.log('Build complete.')
}
