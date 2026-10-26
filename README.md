# Expense Tracker PWA

Paste a bank SMS and the app fills in the amount, date, merchant, payment method
and category. You check the fields and save. Each device keeps its data in
IndexedDB, so the app works offline. Supabase syncs the data, so your phone and
laptop share one ledger.

It is plain HTML, CSS and ES modules with no build step. Dexie and supabase-js
are pinned from jsDelivr, and the service worker caches them.

## Run it locally

```sh
python3 -m http.server 8000      # any static server works
# open http://localhost:8000
```

The app runs **local-only** until `js/config.js` is filled in. Parsing, saving,
the List and Stats screens and export all work without an account.

Parser tests: open `http://localhost:8000/tests/parser.html`, or run
`node tests/run.mjs`.

## Set up sync (Supabase)

1. Create a Supabase project. Mumbai is the closest region to Delhi.
2. Open **SQL Editor**, paste [`supabase/schema.sql`](supabase/schema.sql) and run it once.
3. In **Authentication → Email Templates → Magic Link**, put `{{ .Token }}` in the
   body so the email carries a 6-digit code. A code avoids a magic link opening
   in the browser instead of the installed app.
4. Copy the project URL and the anon / publishable key from **Project Settings → API**
   into [`js/config.js`](js/config.js). Never use the `service_role` / secret key here.
5. Deploy and sign in with your email on each device.
6. After you have created your account, turn off **Allow new users to sign up**
   in Supabase Auth settings.

You can check Row Level Security by signing in with a second email: its list should be empty.

## Deploy

Push to GitHub and enable **Settings → Pages** (deploy from the branch root).
Netlify or Cloudflare Pages also work if you drag the folder in. A PWA needs
HTTPS to install, and all three hosts provide it.

- **Android:** open the site in Chrome → *Install app*. The app then shows up in the
  share sheet, so you can share an SMS from Messages straight into it.
- **iPhone:** Safari → Share → *Add to Home Screen*. iOS has no web share target,
  so you copy the SMS and tap *Paste from clipboard*.

**Bump `VERSION` in `sw.js` on every deploy.** The service worker serves the
app shell from its cache, and a new version number is what makes phones fetch
the new files.

## How it works

```
index.html, css/app.css      app shell + bottom tabs (Add, List, Stats, Settings)
manifest.webmanifest         install + Android share target (opens ./?text=…)
sw.js                        offline cache
js/app.js                    boot, tab routing, share / Ctrl+V paste handling
js/config.js                 Supabase URL + public key
js/supabase.js               client + email-code login
js/db.js                     IndexedDB tables (Dexie), saveRow, stableId
js/seed.js                   starter categories + first card; re-keys signed-out rows on first sign-in
js/sync.js                   push dirty rows, then pull rows newer than the last pull
js/parser/parse.js           SMS text -> fields
js/parser/resolve.js         fields -> payment method, category, fingerprint
js/ui/                       add.js, list.js, stats.js, settings.js, dom.js
tests/fixtures.js            SMS samples + expected fields
tests/parser.html, run.mjs   test runners (browser / Node)
supabase/schema.sql          tables, triggers, RLS, report view
```

- **Parsing:** `parseSms()` reads the amount, debit or credit, date, bank, the card or
  account's last 4 digits, UPI, merchant and reference number. OTPs, due-date
  reminders and statements show a warning card instead of a draft.
- **Matching:** each saved payment method is scored against the SMS
  (last 4 = 4, keyword = 3, bank = 2, type = 1). A score of 4 or more is a match.
  An unknown card shows a one-tap *New: … · Save* chip.
- **Categories:** your learned rule for that merchant comes first, then the built-in
  keyword map (ZEPTO → Groceries), then an income guess for credits. When you save
  an entry, its merchant's category is remembered for the next SMS.
- **Duplicates:** the fingerprint is `date | amount | last4 | ref or merchant`. Pasting
  the same SMS again shows *Possible duplicate*, with Skip or Save anyway.
- **Sync rules:** ids are made on the device (`crypto.randomUUID()`). Nothing is
  hard-deleted; a delete sets `deleted_at`. The server stamps `updated_at`, and each
  device pulls rows newer than its last pull. Sync is last-write-wins per row.
  Starter rows and learned rules use `stableId()`, so two devices create the
  same row instead of duplicates. A starter row nobody has edited is pushed
  "insert if missing", so it never overwrites an edit made on another device.

## When an SMS parses wrong

Bank SMS formats change and differ by bank. When one parses wrong:

1. Add it to `tests/fixtures.js` with the fields you expected.
2. Fix the regex in `js/parser/parse.js` (or the keyword map in `js/parser/resolve.js`).
3. Rerun `tests/parser.html` or `node tests/run.mjs`.

**Settings → Parser tester** shows what the parser reads from any SMS you paste.

## Limits

- A PWA cannot read your SMS inbox (that needs a native Android app). Paste and
  share are as close as the web gets.
- Sync is last-write-wins per row. That is fine for one person on two devices.
  If two people edit the same row at the same moment, one edit is lost.
- Supabase pauses free projects after a week of low activity. Daily use keeps
  yours awake, and you can resume a paused project from the dashboard with its
  data intact.
- Signing out deletes the data stored on that device, which suits shared
  laptops. The data stays in your account.
