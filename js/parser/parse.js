const BANKS = [
  ['SBI', /\bSBI\b|sbicard|State Bank/i],
  ['HDFC', /\bHDFC\b/i],
  ['ICICI', /\bICICI\b/i],
  ['Axis', /\bAxis\b/i],
  ['Kotak', /\bKotak\b/i],
  ['IDFC', /\bIDFC\b/i],
  ['Yes Bank', /\bYes ?Bank\b/i],
  ['PNB', /\bPNB\b|Punjab National/i],
  ['BoB', /\bBank of Baroda\b|\bBoB\b/i],
  ['AU', /\bAU Bank\b|AU Small Finance/i],
  ['OneCard', /\bOneCard\b/i],
];

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

const NOT_A_TXN = /\b(OTP|one time password|is due|due date|statement|min(?:imum)? amt|available (?:credit )?limit is|will be debited|request(?:ed)? money|collect request)\b/i;
const CREDIT_WORDS = /\b(credited|received|refund(?:ed)?|reversed|reversal|cashback|deposited)\b/i;
const DEBIT_WORDS  = /\b(spent|debited|paid|withdrawn|purchase|sent|used|txn of|transaction of|charged)\b/i;

const pad = n => String(n).padStart(2, '0');
const fullYear = y => (y.length === 2 ? 2000 + Number(y) : Number(y));

function parseDate(s) {
  let m = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);          // 26/10/26, 26-10-2026
  if (m) return `${fullYear(m[3])}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);                               // 2026-10-26
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  for (const d of s.matchAll(/\b(\d{1,2})[\s\-]?([A-Za-z]{3})[a-z]*[\s\-,]*(\d{2,4})?\b/g)) { // 26-Oct-26, 24Oct26
    const mon = MONTHS[d[2].toLowerCase()];
    if (mon) return `${d[3] ? fullYear(d[3]) : new Date().getFullYear()}-${pad(mon)}-${pad(d[1])}`;
  }
  return null;
}

function parseAmount(s) {
  const m = s.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i)
         || s.match(/\b(?:debited|credited|spent|paid|sent)\s+(?:by|with|for|of)?\s*([\d,]+\.\d{1,2})\b/i); // "debited by 120.00"
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

function parseInstrument(s) {
  // Credit / debit card ending 1046, Card XX1046, card no. ****1046
  let m = s.match(/(credit|debit)?\s*card[^\d]{0,25}?(?:ending(?: with)?|no\.?|x+|\*+)\s*[x*]*\s*(\d{4})\b/i);
  if (m) return { type: (m[1] || 'credit').toLowerCase() === 'debit' ? 'debit_card' : 'credit_card', last4: m[2] };
  // A/c XX1234, A/C no. *1234, account ending 1234
  m = s.match(/(?:a\/c|acct|account)[^\d]{0,15}?[x*]*\s*(\d{3,6})\b/i);
  if (m) return { type: 'bank_account', last4: m[1].slice(-4) };
  if (/\bupi\b|VPA/i.test(s)) return { type: 'upi', last4: null };
  return { type: null, last4: null };
}

function parseMerchant(s, direction) {
  const END = String.raw`(?=\s+(?:on|via|ref\w*|UPI|Avl|Txn|has|is|was|credited|debited)\b|\.\s|\.?$)`;
  const toP = new RegExp(String.raw`\b(?:trf to|to)\s+(?!VPA\b)(.+?)` + END, 'i');   // paid to SWIGGY on ...
  const fromP = new RegExp(String.raw`\bfrom\s+(?!(?:your|a\/c)\b)(.+?)` + END, 'i'); // from RAHUL KUMAR.
  const patterns = [
    /\bat\s+(.+?)\s+on\s+\d/i,                         // ... at ZEPTO on 26/10/26
    /\bat\s+(.+?)(?:\.|\s+Avl|\s+Txn|\s+Ref|$)/i,      // ... at AMAZON. Avl Lmt
    /\b(?:to|trf to)\s+VPA\s+(\S+?)(?:\s|$)/i,         // to VPA zomato@icici
    /;\s*([A-Z][A-Za-z0-9 .&'-]{1,40}?)\s+credited/,   // ...; ZOMATO LTD credited
    /\bInfo[:\s]+(.+?)(?:\.|$)/i,                      // Info: UPI/BLINKIT/...
    ...(direction === 'credit' ? [fromP, toP] : [toP, fromP]),
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1].replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  }
  return null;
}

// Stable key for learned rules: "AMAZON PAY IN" -> "amazon pay"
export function merchantKey(name) {
  if (!name) return null;
  let k = name.toLowerCase();
  if (k.includes('@')) k = k.split('@')[0];                          // VPA
  k = k.replace(/upi\/|\/.*$/g, '')                                 // UPI/BLINKIT/... -> blinkit
       .replace(/\b(pvt|private|ltd|limited|india|technologies|tech|retail|marketplace|payments?|services|online|com|www)\b/g, '')
       .replace(/[^a-z0-9]+/g, ' ').trim();
  return k.split(' ').slice(0, 2).join(' ') || null;
}

export function parseSms(raw) {
  const s = raw.replace(/\s+/g, ' ').trim();
  const amount = parseAmount(s);
  const warnings = [];
  if (amount == null) warnings.push('No amount found');
  if (NOT_A_TXN.test(s)) warnings.push('Looks like an alert, not a transaction');

  const direction = CREDIT_WORDS.test(s) && !DEBIT_WORDS.test(s) ? 'credit' : 'debit';
  const bank = (BANKS.find(([, re]) => re.test(s)) || [null])[0];
  const instrument = parseInstrument(s);
  const merchant = parseMerchant(s, direction);
  const ref = (s.match(/\b(?:UPI\s*)?(?:Ref(?:erence)?|Txn(?:\s*ID)?)\s*(?:no|num(?:ber)?|id)?\.?[:\s#]*(\d{6,}|[A-Z0-9]{8,})/i) || [])[1] || null;

  return {
    amount, direction,
    date: parseDate(s) || new Date().toLocaleDateString('en-CA'),   // local YYYY-MM-DD
    bank, instrumentType: instrument.type, last4: instrument.last4,
    viaUpi: /\bupi\b|VPA/i.test(s),
    merchant, merchantKey: merchantKey(merchant), ref,
    warnings, raw: raw.trim(),
  };
}

// A paste of several SMS -> array of messages
export function splitMessages(text) {
  return text.split(/\n\s*\n|(?=(?:Rs\.?|INR|₹)\s*[\d,]+(?:\.\d{1,2})?\s+(?:spent|debited|credited))/i)
             .map(t => t.trim()).filter(t => t.length > 20);
}
