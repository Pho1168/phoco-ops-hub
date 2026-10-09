# PHO & CO Ops Hub

Operations app for PHO & CO restaurants (Eastcote, Sydenham) and the Wembley central production kitchen.
Built for shared Android phones and tablets on site: staff pick their name, enter a PIN and work through
the day's checklists. Owners see every site, resolve alerts and control accounts.

## What works today

- **Sign in** with name + 4–6 digit PIN, per site. 5 wrong PINs locks the account for 15 minutes.
- **Today screen**: the site's checklists for each section (FOH, BOH, Production) with due times, overdue flags, open alerts and handover items.
- **Checklists**: tick items, temperature readings, numbers, text, photo placeholders. Readings are checked against the approved limits:
  - Fridge: target ≤ 5 °C, legal limit 8 °C
  - Freezer: target ≤ −18 °C (warning only)
  - Cooking: core ≥ 75 °C
  An out-of-range reading must have a corrective action before the list can be signed off, and a failed one raises an alert for managers.
- **Sign-off** requires the PIN again. Signed records are locked; corrections are added as new entries.
- **Handover** notes between shifts. "Needs action" items stay open until someone closes them.
- **Owner control**:
  - site overview
  - resolve alerts (a note is required)
  - log out or freeze any account
  - **close a site with one button**, which logs everyone out there and freezes staff who only work at that site; reopening unfreezes them
  - audit trail of every action

Not built yet: the Supabase connection, rota reminders from Google Sheets, Wembley batch codes, labels, dispatch and receiving, and the remaining MVP features. See the PRD.

## Try it (demo mode)

With no database configured the app runs in **demo mode** on sample data held in memory. Restarting the server resets the data.

```bash
npm install
npm run dev          # http://localhost:3000
```

Demo PINs: owner **2580**, everyone else **1357**. The demo people are clearly labelled "(demo)". No real staff data is in this repo.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests for the rules (temperatures, sign-off, access, rota, PINs) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `node scripts/build-seed.mjs` | Regenerates `supabase/seed.sql` from `data/checklist-library.json` |

## How it's put together

- **Next.js 14 (App Router) + TypeScript.** Pages render on the server, and buttons call *server actions* (functions that run on the server, never in the browser).
- **`src/lib/domain/`** holds the business rules as plain functions with no database. This is the part the tests cover.
- **`src/lib/data/`** has a `Store` interface with two planned implementations: `DemoStore` (in memory, used now) and `SupabaseStore` (to come). The app switches to Supabase when `SUPABASE_URL` is set.
- **`supabase/migrations/0001_core.sql`** is the database schema. Row Level Security is on for every table with no policies, so only the server (service role) can read or write. Checklist answers, corrective actions and the audit log are **append-only**: a database trigger refuses edits and deletes.
- **Sessions** are an httpOnly cookie checked on every request, so freezing someone or closing a site takes effect immediately.

## Security notes

- PINs are stored as scrypt hashes and compared in constant time. Owners cannot see PINs.
- Never commit `.env` files, staff names, phone numbers or PINs. Real staff data lives only in the database.
- Temperature limits in `temp_rules` are **placeholders until the owner confirms them** against the approved HACCP plan.
