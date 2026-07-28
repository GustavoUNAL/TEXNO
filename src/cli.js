#!/usr/bin/env node
import { resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { analyzeTrack, toYaml } from './analyzer/index.js';

function usage() {
  console.log(`Usage:
  npm run analyze -- <file.mp3|wav|flac> [--format json|yaml] [--out path]

Examples:
  npm run analyze -- ./track.mp3
  npm run analyze -- ./track.wav --format yaml --out dna.yaml
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(args.length ? 0 : 1);
  }

  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    usage();
    process.exit(1);
  }

  const formatIdx = args.indexOf('--format');
  const format = formatIdx >= 0 ? args[formatIdx + 1] : 'json';
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : null;

  const path = resolve(file);
  console.error(`Analyzing ${path} …`);
  const dna = await analyzeTrack({ path, filename: file.split(/[/\\]/).pop() });

  const text =
    format === 'yaml' || format === 'yml'
      ? toYaml(dna)
      : JSON.stringify(dna, null, 2);

  if (out) {
    const dest = resolve(out);
    await mkdir(resolve(dest, '..'), { recursive: true });
    await writeFile(dest, text, 'utf8');
    console.error(`Wrote ${dest}`);
  } else {
    process.stdout.write(text + '\n');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
