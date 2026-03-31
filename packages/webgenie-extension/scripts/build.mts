/**
 * Build script: copies manifest, HTML, icons and compiled JS into dist/
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.resolve(ROOT, 'dist')
const SRC = path.resolve(ROOT, 'src')

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

async function copyIfExists(src: string, dest: string): Promise<void> {
  if (existsSync(src)) {
    await mkdir(path.dirname(dest), { recursive: true })
    await copyFile(src, dest)
    console.log(`  ✓ ${path.relative(ROOT, dest)}`)
  }
}

async function build(): Promise<void> {
  console.log('📦 Building WebGenie extension...\n')

  // 1. Clean and create dist structure
  await ensureDir(DIST)
  await ensureDir(path.join(DIST, 'background'))
  await ensureDir(path.join(DIST, 'content'))
  await ensureDir(path.join(DIST, 'sidepanel'))
  await ensureDir(path.join(DIST, 'icons'))

  // 2. Copy manifest
  await copyIfExists(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'))

  // 3. Copy compiled JS (TypeScript emits to dist/ via tsconfig outDir)
  //    The tsc compiler already outputs to dist/, so JS files are already there.
  //    We just need to ensure the folder structure matches manifest references.
  console.log('\nNote: TypeScript files compiled by tsc into dist/')
  console.log('Run `tsc` before this script to compile TypeScript sources.\n')

  // 4. Copy sidepanel HTML
  await copyIfExists(
    path.join(SRC, 'sidepanel', 'sidepanel.html'),
    path.join(DIST, 'sidepanel', 'sidepanel.html'),
  )

  // 5. Generate placeholder icons (real icons should be placed in src/icons/)
  const iconSizes = [16, 32, 48, 128]
  for (const size of iconSizes) {
    const iconSrc = path.join(ROOT, 'src', 'icons', `icon${size}.png`)
    const iconDst = path.join(DIST, 'icons', `icon${size}.png`)
    if (existsSync(iconSrc)) {
      await copyFile(iconSrc, iconDst)
    }
    // If icons don't exist yet, that's OK — extension loads without them
  }

  console.log('✅ Build complete → dist/')
  console.log('\nTo load in Chrome:')
  console.log('  1. Open chrome://extensions')
  console.log('  2. Enable "Developer mode"')
  console.log('  3. Click "Load unpacked" → select packages/webgenie-extension/dist')
}

build().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
