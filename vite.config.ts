import { defineConfig } from 'vitest/config';
import { cpSync, mkdirSync } from 'node:fs';
// Relative paths keep the build portable to GitHub project Pages and subdirectories.
export default defineConfig({
  base: './',
  plugins: [{ name: 'local-pdf-assets', buildStart() {
    mkdirSync('public/pdfjs', {recursive: true});
    cpSync('node_modules/pdfjs-dist/LICENSE', 'public/pdfjs/LICENSE');
    for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      mkdirSync(`public/pdfjs/${dir}`, {recursive: true});
      cpSync(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, {recursive: true});
    }
  }}],
  test: {include: ['tests/**/*.test.ts']},
  server: {host: '0.0.0.0'}
});
