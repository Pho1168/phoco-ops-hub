# PHO & CO Ops Hub

Operations app for PHO & CO restaurants (Eastcote, Sydenham) and the Wembley central production kitchen.
Built for shared Android phones and tablets on site: staff pick their name, enter a PIN and work through
the day's checklists. Owners see every site, resolve alerts and control accounts.

## What works today

- **Site tablets only**: staff names and the name + PIN sign-in appear only on tablets registered to a site with a one-time set-up code from an owner. Any other device shows no names, just a pairing box and an owner sign-in (staff ID + PIN). Removing a tablet signs out everyone on it.
- **Sign in** with name + 4-digit PIN. 5 wrong PINs (at sign-in, sign-off or PIN change) locks the account for 15 minutes.
- **Staff management** (owners): add people, sites, roles, sections; temporary PINs that must be changed on first use; reset PIN; mark as left.
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

- **Rota and reminders**: each site's rota Google Sheet sends its Export, week status (Settings) and Staff tabs every hour through a small Apps Script (Owner → Rota sheets → Connect sheet). Only Published weeks are shown or messaged. Staff sign in on their own phone with staff ID + PIN to a limited **My shifts** view and turn on notifications: a list when a week is published, a message when a published shift changes, and a reminder at 18:00 the evening before. Nothing is sent 22:00–08:00. A Supabase schedule (pg_cron) calls `/api/cron/tick` every 10 minutes.

- **Kitchen prep handover** (Eastcote; kitchen staff and managers): one master list of 63 prep items shared by every restaurant (`prep_items`, switched on per site in `prep_sites`). The outgoing shift taps only what's needed (saved as a draft as they go, shared by everyone on shift), can mark an item urgent or add a note, picks Next shift / Tomorrow morning / Tomorrow evening, and sends with "everything else is stocked". The incoming shift gets one report and taps items done (undo within 10 minutes). Done items leave the list but are kept with who and when. Anything still outstanding when the next handover is sent carries into it once, and the manager gets an alert.

Not built yet: Wembley batch codes, labels, dispatch and receiving, and the remaining MVP features. See the PRD.

## Try it (demo mode)

With no database configured the app runs in **demo mode** on sample data held in memory. Restarting the server resets the data. Demo mode skips the site-tablet check.

```bash
npm install
npm run dev          # http://localhost:3000
```

Demo PINs: owner **4826**, everyone else **1357**. The demo people are clearly labelled "(demo)". No real staff data is in this repo.

## Run it on the real database

The app uses the database when the server has a `DATABASE_URL` (Supabase project **phoco-ops-hub**, London).

1. In Supabase: **Project Settings → Database → Connection string → Transaction pooler** (port 6543). Copy it and put in the database password.
2. Put it in the hosting provider's environment settings as `DATABASE_URL`. For local use, put it in `.env.local`, which git ignores.
3. Create the first owner, typing the PIN when asked (it is never shown or stored in plain text):

```bash
DATABASE_URL=... npm run person:add -- --code 001 --name "First name" --access "EAS:owner:FOH,BOH;WEM:owner:PROD;SYD:owner"
```

Access is `SITE:role:SECTIONS`, separated by `;`. Roles are owner, manager and staff. Sections are FOH, BOH and PROD.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests for the rules (temperatures, sign-off, access, rota, PINs) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run person:add` | Create or update a person, their site access and PIN (see above) |
| `node scripts/build-seed.mjs` | Regenerates `supabase/seed.sql` from `data/checklist-library.json` |

## How it's put together

- **Next.js 14 (App Router) + TypeScript.** Pages render on the server, and buttons call *server actions* (functions that run on the server, never in the browser).
- **`src/lib/domain/`** holds the business rules as plain functions with no database. This is the part the tests cover.
- **`src/lib/data/`** has a `Store` interface with two implementations: `DemoStore` (in memory) and `SqlStore` (Postgres/Supabase). The app uses `SqlStore` whenever `DATABASE_URL` is set.
- **`supabase/migrations/0001_core.sql`** is the database schema. Row Level Security is on for every table with no policies, so the public Supabase API can read nothing; only the app server, connecting with the database connection string, can read or write. Checklist answers, corrective actions and the audit log are **append-only**: a database trigger refuses edits and deletes.
- **Sessions** are an httpOnly cookie checked on every request, so freezing someone or closing a site takes effect immediately.

## Security notes

- PINs are stored as scrypt hashes and compared in constant time. Owners cannot see PINs.
- Never commit `.env` files, staff names, phone numbers or PINs. Real staff data lives only in the database.
- Temperature limits in `temp_rules` are **placeholders until the owner confirms them** against the approved HACCP plan.
