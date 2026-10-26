// Real-world bank SMS samples and the fields the parser should pull out.
// When a new SMS parses wrong: paste it here with what you expected, fix the
// regex in js/parser/parse.js, and rerun tests/parser.html (or `node tests/run.mjs`).
//
// `expect` lists only the fields worth checking; anything left out is ignored.
// `category` is the suggested category name; `notTxn: true` means the parser
// must warn instead of producing a draft.

export const FIXTURES = [
  {
    name: 'SBI credit card at ZEPTO',
    sms: 'Rs.1,002.00 spent on your SBI Credit Card ending 1046 at ZEPTO on 26/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute',
    expect: { amount: 1002, direction: 'debit', date: '2026-10-26', bank: 'SBI', instrumentType: 'credit_card', last4: '1046',
              merchant: 'ZEPTO', category: 'Groceries', method: 'SBI Credit Card', methodIsNew: false },
  },
  {
    name: 'HDFC UPI to SWIGGY',
    sms: 'Sent Rs.250.00 From HDFC Bank A/C *4321 To SWIGGY On 25/10/26 Ref 529812345678 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808',
    expect: { amount: 250, direction: 'debit', date: '2026-10-25', bank: 'HDFC', instrumentType: 'bank_account', last4: '4321',
              viaUpi: true, merchant: 'SWIGGY', ref: '529812345678', category: 'Food & dining', methodIsNew: true },
  },
  {
    name: 'SBI account UPI to BLINKIT',
    sms: 'Dear UPI user A/C X5678 debited by 120.00 on date 24Oct26 trf to BLINKIT Refno 429876543210. If not u? call 1800111109. -SBI',
    expect: { amount: 120, direction: 'debit', date: '2026-10-24', bank: 'SBI', instrumentType: 'bank_account', last4: '5678',
              viaUpi: true, merchant: 'BLINKIT', ref: '429876543210', category: 'Groceries', methodIsNew: true },
  },
  {
    name: 'ICICI card at AMAZON PAY IN',
    sms: 'INR 3,499.00 spent on ICICI Bank Card XX9012 on 23-Oct-26 at AMAZON PAY IN. Avl Lmt: INR 1,23,456.00. To dispute, call 18001080/SMS BLOCK 9012 to 9215676766',
    expect: { amount: 3499, direction: 'debit', date: '2026-10-23', bank: 'ICICI', instrumentType: 'credit_card', last4: '9012',
              merchant: 'AMAZON PAY IN', merchantKey: 'amazon pay', category: 'Shopping', methodIsNew: true },
  },
  {
    name: 'Axis account credit from a person',
    sms: 'Your A/c XX7788 is credited with Rs.5,000.00 on 22-10-26 by UPI from RAHUL KUMAR. UPI Ref 123456789012 -Axis Bank',
    expect: { amount: 5000, direction: 'credit', date: '2026-10-22', bank: 'Axis', instrumentType: 'bank_account', last4: '7788',
              viaUpi: true, merchant: 'RAHUL KUMAR', ref: '123456789012', category: 'Salary' },
  },
  {
    name: 'OTP is not a transaction',
    sms: '123456 is your OTP for txn of Rs.500.00 at FLIPKART on your HDFC Bank card ending 1234. Do not share it with anyone.',
    expect: { amount: 500, notTxn: true },
  },
  {
    name: 'Learned rule beats the built-in map',
    sms: 'Rs.640.00 spent on your SBI Credit Card ending 1046 at SWIGGY INSTAMART on 21/10/26.',
    rules: [{ merchant_key: 'swiggy instamart', category: 'Food & dining' }],
    expect: { amount: 640, merchant: 'SWIGGY INSTAMART', merchantKey: 'swiggy instamart', category: 'Food & dining', categorySource: 'learned' },
  },
  {
    name: 'Longest keyword wins (instamart is groceries)',
    sms: 'Rs.410.00 spent on your SBI Credit Card ending 1046 at SWIGGY INSTAMART on 20/10/26.',
    expect: { merchant: 'SWIGGY INSTAMART', category: 'Groceries', categorySource: 'built-in' },
  },
  {
    name: 'UPI to a VPA',
    sms: 'Rs 349.00 debited from A/c XX4321 to VPA zomato@icici on 19-10-2026. UPI Ref No 512345678901. -HDFC Bank',
    expect: { amount: 349, date: '2026-10-19', bank: 'HDFC', last4: '4321', merchant: 'zomato@icici', merchantKey: 'zomato',
              ref: '512345678901', category: 'Food & dining' },
  },
  {
    name: 'Refund is a credit',
    sms: 'Refund of Rs.799.00 from MYNTRA has been credited to your ICICI Bank Card XX9012 on 18-Oct-26.',
    expect: { amount: 799, direction: 'credit', last4: '9012', merchant: 'MYNTRA', category: 'Shopping' },
  },
  {
    name: 'Credit with no known merchant guesses Refunds',
    sms: 'Rs.150.00 reversed and credited to your A/c XX7788 on 17/10/26. -Axis Bank',
    expect: { amount: 150, direction: 'credit', category: 'Refunds', categorySource: 'guess' },
  },
  {
    name: 'Bill reminder is not a transaction',
    sms: 'Your SBI Card statement is generated. Total amt due Rs.12,345.00, min amt due Rs.620.00. Payment due date 05/11/26.',
    expect: { notTxn: true },
  },
];

// Categories and payment methods the resolve step is tested against
export const TEST_CATEGORIES = ['Groceries', 'Food & dining', 'Shopping', 'Transport', 'Salary', 'Refunds']
  .map((name, i) => ({ id: `cat-${i}`, name, kind: ['Salary', 'Refunds'].includes(name) ? 'income' : 'expense' }));

export const TEST_METHODS = [
  { id: 'pm-sbi', name: 'SBI Credit Card', type: 'credit_card', bank: 'SBI', last4: '1046', keywords: [] },
];
