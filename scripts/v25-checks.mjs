import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.resolve(root, process.argv[2] ?? '.dev-data/v2.5-final');
await mkdir(out, { recursive: true });
const checks = [
  ...['cargo fmt --all --check', 'cargo clippy --workspace --all-targets --offline -- -D warnings', 'cargo test --workspace --offline'].map(command => ({ command, cwd: root })),
  ...['npm run check', 'npm run typecheck', 'npm test', 'npx playwright test --project=functional', 'npx playwright test --project=perf', 'npx playwright test --project=perf-canvas'].map(command => ({ command, cwd: path.join(root, 'apps/desktop') })),
];
const results = [];
for (const { command, cwd } of checks) {
  console.log(`START ${command}`);
  let log = '';
  const child = spawn('cmd.exe', ['/d', '/c', command], { cwd, windowsHide: true, env: { ...process.env, JAM_PERF_OUTPUT: out, JAM_CANVAS_PERF_OUTPUT: out } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { log += b; });
  const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
  await writeFile(path.join(out, `${results.length}.log`), log);
  results.push({ command, code });
  console.log(`${command}: ${code}`);
  await writeFile(path.join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
}
process.exitCode = results.some(r => r.code !== 0) ? 1 : 0;
