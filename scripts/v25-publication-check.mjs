import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), tokens = [], unreadable = [];
const personalHome = process.env.USERPROFILE?.replace(/[\\/]+/g, '/').toLowerCase();
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (e.isFile() && e.name === 'mcp-token') {
      try { const v = (await readFile(p, 'utf8')).trim(); if (v) tokens.push(v); }
      catch { unreadable.push(path.relative(root, p)); }
    }
  }
}
await walk(path.join(root, '.dev-data'));
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
const files = git(['ls-files', '-z']).split('\0').filter(Boolean), tokenMatches = [], personalPaths = [], privateLinks = [], sizes = [];
for (const file of files) {
  const bytes = await readFile(file); sizes.push({ path: file, bytes: (await stat(file)).size });
  if (tokens.some(t => bytes.includes(Buffer.from(t)))) tokenMatches.push(file);
  if (file.startsWith('.dev-data/')) tokenMatches.push(file);
  if (file.startsWith('docs/briefs/') || /^docs\/report-/.test(file)) continue;
  const text = bytes.toString('utf8'), normalized = text.replace(/%(?:5c|2f)/gi, '/').replace(/%3a/gi, ':').replace(/[\\/]+/g, '/').toLowerCase();
  if (personalHome && normalized.includes(personalHome)) personalPaths.push(file);
  if (file.endsWith('.md')) for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (!/^https?:/i.test(target) && /(?:^|\/)(?:briefs\/|report-[^/]*\.md)/.test(target)) privateLinks.push({ file, target });
  }
}
const objects = git(['rev-list', '--objects', '--all']);
const inventory = execFileSync('git', ['cat-file', '--batch-check=%(objecttype) %(objectname) %(objectsize) %(rest)'], { input: objects, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
const history = inventory.split('\n').map(line => { const m = line.match(/^blob ([0-9a-f]+) (\d+) (.*)$/); return m ? { object: m[1], bytes: Number(m[2]), path: m[3] } : null; }).filter(Boolean).sort((a, b) => b.bytes - a.bytes).slice(0, 12);
const result = { scope: 'All tracked/staged files; briefs and reports exempt only from personal-path/private-link scans. Token scan includes them.', files: files.length, trackedBytes: sizes.reduce((n, f) => n + f.bytes, 0), mediaBytes: sizes.filter(f => f.path.startsWith('docs/media/')).reduce((n, f) => n + f.bytes, 0), tokenFiles: tokens.length, tokenMatches, unreadable, personalPaths, privateLinks, largestFiles: sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 12), largestHistoryBlobs: history, gitSize: git(['count-objects', '-vH']).trim(), clean: !tokenMatches.length && !personalPaths.length && !privateLinks.length && !unreadable.length };
await writeFile(process.argv[2] ?? 'docs/media/v2.5/publication-check.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
process.exitCode = result.clean ? 0 : 1;
