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

The app runs **local-only** until you connect it to Supabase in **Settings → Connect sync**.
Parsing, saving, the List and Stats screens and export all work without an account.

Parser tests: open `http://localhost:8000/tests/parser.html`, or run
`node tests/run.mjs`.

## Set up sync (Supabase)

1. Create a Supabase project. Mumbai is the closest region to Delhi.
2. Open **SQL Editor**, paste [`supabase/schema.sql`](supabase/schema.sql) and run it once.
3. In **Authentication → Email Templates → Magic Link**, put `{{ .Token }}` in the
   body so the email carries a 6-digit code. A code avoids a magic link opening
   in the browser instead of the installed app.
4. Deploy the app. On each device, open **Settings → Connect sync** and paste the
   **Project URL** and the **anon / publishable key** from Supabase → Project Settings → API.
   The app checks them against your project before saving, and refuses a
   `service_role` / secret key.
5. Sign in with your email on each device.
6. After you have created your account, turn off **Allow new users to sign up**
   in Supabase Auth settings.

You can check Row Level Security by signing in with a second email: its list should be empty.

**Where the keys live:** the URL and key are kept only in that browser's
`localStorage` on that device. They are not in the repo, the app's files,
IndexedDB, the JSON/CSV export or the sync. To change them, sign out, then use
**Change** in the *Sync connection* card. **Remove from this device** deletes
them; if you were signed in, it also signs out and clears that device's copy
of your data. The anon key is still a public key that the browser sends with
every request, so anyone using that device's browser could read it. Row Level
Security is what protects your data.

## Deploy

**GitHub Pages:** in **Settings → Pages**, set *Source* to **GitHub Actions** (once).
After that, every push to `main` runs [`.github/workflows/static.yml`](.github/workflows/static.yml):
it runs the parser tests, then publishes only the app files (not `tests/`, `supabase/`
or this README) to `https://<you>.github.io/<repo>/`. You can also start it by hand from
the **Actions** tab. Pull requests run the tests but do not deploy.

Netlify or Cloudflare Pages also work if you drag the folder in (bump `VERSION` in
`sw.js` yourself there). A PWA needs HTTPS to install, and all three hosts provide it.

- **Android:** open the site in Chrome → *Install app* (the Add screen also offers an
  *Install app* button). The installed app then shows up in the share sheet: in
  Messages, long-press an SMS → Share → *Expenses*, and it opens as a draft ready
  to save. If the app is already open, the share is added to the screen without
  reloading it, so unsaved drafts stay. Sharing works offline too, because the
  service worker serves the app shell.
- **iPhone:** Safari → Share → *Add to Home Screen*. iOS has no web share target,
  so you copy the SMS and tap *Paste from clipboard*.

**Updates:** the service worker serves the app shell from its cache, and a new
`VERSION` is what makes phones fetch the new files. The Pages workflow sets it to
the commit hash on every deploy, so installed apps update by themselves the next
time they open. The `'v1'` in the repo is only a placeholder.

## How it works

```
index.html, css/app.css      app shell + bottom tabs (Add, List, Stats, Settings)
manifest.webmanifest         install + Android share target (opens ./?text=…)
sw.js                        offline cache
js/app.js                    boot, tab routing, share / Ctrl+V paste handling
js/supabase.js               sync connection (kept in this device's localStorage) + email-code login
js/db.js                     IndexedDB tables (Dexie), saveRow, stableId
js/seed.js                   starter categories + first card; re-keys signed-out rows on first sign-in
js/sync.js                   push dirty rows, then pull rows newer than the last pull
js/parser/parse.js           SMS text -> fields
js/parser/resolve.js         fields -> payment method, category, fingerprint
js/history.js                most-used categories and tags, last entry per merchant (pure functions)
js/ui/                       add.js, list.js, stats.js, settings.js, dom.js, pickers.js, install.js
tests/fixtures.js            SMS samples + expected fields
tests/history-check.js       checks for js/history.js
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
- **Picking a category:** tap the Category field to open a search sheet. Your most-used
  categories come first, typing filters the list, and *+ Add "name"* creates a new
  category on the spot.
- **Payment method on the card:** the dropdown has *+ New* and *Edit* buttons (the same
  form as in Settings), and an *Other… (type a name)* option for a method that is not
  in the list. A name you type is saved as a new method when you save the entry.
- **Tags:** type a tag and press Enter or comma, or tap one of your most-used tags.
  Earlier tags autocomplete.
- **Last time:** when the merchant was saved before, a strip under it shows that
  entry's category, payment method and tags with an *Apply* button. Nothing is
  filled until you tap it.
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
