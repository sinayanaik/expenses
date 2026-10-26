export const DEFAULT_MERCHANTS = {              // keyword -> category name (longest match wins)
  'Groceries':        ['zepto', 'blinkit', 'bigbasket', 'swiggy instamart', 'instamart', 'dmart', 'jiomart'],
  'Food & dining':    ['swiggy', 'zomato', 'dominos', 'mcdonald', 'starbucks', 'kfc', 'eatsure'],
  'Shopping':         ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'croma'],
  'Transport':        ['uber', 'ola', 'rapido', 'irctc', 'dmrc', 'metro', 'fastag'],
  'Fuel':             ['indian oil', 'iocl', 'hpcl', 'bpcl', 'shell'],
  'Bills & utilities':['airtel', 'jio', 'bses', 'tata power', 'act fibernet', 'electricity'],
  'Subscriptions':    ['netflix', 'spotify', 'hotstar', 'prime video', 'youtube'],
  'Health':           ['apollo', 'pharmeasy', '1mg', 'netmeds'],
  'Travel':           ['makemytrip', 'goibibo', 'indigo', 'air india', 'oyo', 'airbnb'],
};

const KEYWORDS = Object.entries(DEFAULT_MERCHANTS)
  .flatMap(([cat, words]) => words.map(w => [w, cat]))
  .sort((a, b) => b[0].length - a[0].length);

export function matchPaymentMethod(p, methods) {
  const raw = p.raw.toLowerCase();
  let best = null, bestScore = 0;
  for (const m of methods) {
    if (m.deleted_at || m.archived) continue;
    let score = 0;
    if (p.last4 && m.last4 === p.last4) score += 4;
    if (p.bank && m.bank && m.bank.toLowerCase() === p.bank.toLowerCase()) score += 2;
    if ((m.keywords || []).some(k => raw.includes(k.toLowerCase()))) score += 3;
    if (p.instrumentType && m.type === p.instrumentType) score += 1;
    if (score > bestScore) { best = m; bestScore = score; }
  }
  if (best && bestScore >= 4) return { method: best, isNew: false };
  // Unknown card or account: suggest a new method to save in one tap
  const label = { credit_card: 'Credit Card', debit_card: 'Debit Card', bank_account: 'Account', upi: 'UPI' }[p.instrumentType] || 'Payment';
  return { method: p.last4 || p.bank ? {
      name: `${p.bank || 'Bank'} ${label}${p.last4 ? ' ••' + p.last4 : ''}`,
      type: p.instrumentType || 'bank_account', bank: p.bank, last4: p.last4 } : null,
    isNew: true };
}

export function suggestCategory(p, rules, categories) {
  const byName = n => categories.find(c => !c.deleted_at && c.name === n) || null;
  const rule = p.merchantKey && rules.find(r => !r.deleted_at && r.merchant_key === p.merchantKey);
  if (rule) return { category: categories.find(c => c.id === rule.category_id), source: 'learned' };
  const m = (p.merchant || '').toLowerCase();
  const hit = KEYWORDS.find(([w]) => m.includes(w));
  if (hit) return { category: byName(hit[1]), source: 'built-in' };
  if (p.direction === 'credit') return { category: byName(/refund|revers/i.test(p.raw) ? 'Refunds' : 'Salary'), source: 'guess' };
  return { category: null, source: null };
}

export function fingerprint(p) {
  return [p.date, p.amount?.toFixed(2), p.last4 || '', p.ref || p.merchantKey || ''].join('|');
}
