// Command-line runner: node tests/run.mjs
import { runAll } from './check.js';

const results = runAll();
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  for (const d of r.diffs) console.log(`      ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.got)}`);
}
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
