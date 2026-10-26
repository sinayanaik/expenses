// Runs every fixture through parseSms() + resolve and compares with `expect`.
// Shared by tests/parser.html (browser) and tests/run.mjs (Node).
import { parseSms, splitMessages } from '../js/parser/parse.js';
import { matchPaymentMethod, suggestCategory, fingerprint } from '../js/parser/resolve.js';
import { FIXTURES, TEST_CATEGORIES, TEST_METHODS } from './fixtures.js';
import { historyResults } from './history-check.js';

export function resolveFixture(f) {
  const p = parseSms(f.sms);
  const rules = (f.rules || []).map(r => ({
    merchant_key: r.merchant_key,
    category_id: TEST_CATEGORIES.find(c => c.name === r.category).id,
  }));
  const pm = matchPaymentMethod(p, TEST_METHODS);
  const cat = suggestCategory(p, rules, TEST_CATEGORIES);
  return {
    ...p,
    notTxn: p.warnings.length > 0,
    method: pm.method?.name ?? null,
    methodIsNew: pm.isNew,
    category: cat.category?.name ?? null,
    categorySource: cat.source,
    fingerprint: fingerprint(p),
  };
}

export function runAll() {
  const results = FIXTURES.map(f => {
    const got = resolveFixture(f);
    const diffs = Object.entries(f.expect)
      .filter(([k, v]) => got[k] !== v)
      .map(([k, v]) => ({ field: k, expected: v, got: got[k] }));
    return { name: f.name, sms: f.sms, got, diffs, pass: diffs.length === 0 };
  });

  // A paste of several SMS at once splits into one message each
  const joined = FIXTURES.slice(0, 4).map(f => f.sms).join('\n\n');
  const parts = splitMessages(joined);
  results.push({
    name: 'splitMessages: 4 SMS pasted together',
    sms: joined, got: { count: parts.length },
    diffs: parts.length === 4 ? [] : [{ field: 'count', expected: 4, got: parts.length }],
    pass: parts.length === 4,
  });
  return [...results, ...historyResults()];
}
