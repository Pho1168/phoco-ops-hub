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

- **Rota and reminders**: each site's rota Google Sheet sends its Export, week status (Settings) and Staff tabs every hour through a small Apps Script (Owner → Rota sheets → Connect sheet). Only Published weeks are shown or messaged. Staff sign in on their own phone with staff ID + PIN to a limited **My shifts** view and turn on notifications: a list when a week is published, a message when a published shift changes, and a reminder at 18:00 the evening before. Nothing is sent 22:00–08:00, except urgent messages (kit not working, P1 tasks), which still go out until midnight. A Supabase schedule (pg_cron) calls `/api/cron/tick` every 10 minutes.

- **Handover tab** (prep and notes in one place): everything outstanding for the shift on one list, prep items from the last handover and notes together, each ticked Done (who and when are kept; undo within 10 minutes). Notes can be added at any time and show straight away: **Needs action** notes stay until ticked, **For info** notes show for that shift and the next, then drop off. Food-safety notes go to the top. At Eastcote the closing shift also does the **prep handover** from the same tab: one master list of 63 items, tap only what's needed (saved as a shared draft), Next shift / Tomorrow morning / Tomorrow evening, then "everything else is stocked". Anything not done carries into the next handover once, and the manager gets an alert.

- **Team rota** (Rota tab, and "Team rota" on My shifts): the site's week laid out like the Schedule tab in the rota sheet, a grid on a computer and day by day on a phone. Everyone at the site can see published weeks; owners and managers also see paid hours, daily and weekly totals, and draft weeks (marked Draft). Paid hours come from the sheet's Export tab with each hourly sync.

- **Manager tools** (Manage tab for managers; tiles at the top of the Owner screen for owners). Managers use them on the shop tablet; staff phones stay limited to My shifts and the team rota.
  - **Task centre**: everything open at the sites a manager runs, in one list by priority (P1 critical to P4 improvement): critical alerts and broken fridges first, then overdue checklists, food-safety handover actions, urgent prep, run-out certificates, and so on. Managers add one-off tasks for a person, a section or everyone at a site, with a date; they show on Today (and My shifts on a phone) for the people they're for, who tick them done with a note (undo within 10 minutes). Alerts can be resolved from here. Everything else links to where it's dealt with.
  - **Inspection records**: for a site and date range, the temperature log (with limits, out-of-range readings and corrective actions), checklist sign-offs (on time, late, not signed), alerts with how they were resolved, and food-safety handover notes. Printable, with CSV downloads. Days before a site's first recorded checklist aren't counted as missed.
  - **Weekly report**: per site and for the group, Monday to Sunday: checklists on time, temperatures out of range, alerts, handover actions, prep carried over and planned hours, with a change on the week before and a short "needs attention" list in plain words. On Monday at 9am each owner and manager also gets last week's headline numbers for their sites as a message.
  - **Team notices**: post to a site (or every site, for someone who manages them all), optionally only FOH, BOH or PROD, with an end date. Everyone it's for sees it on Today or My shifts until they tap "Got it"; the poster sees who has and hasn't. Important notices also go to phones with notifications on.
  - **Time off**: staff ask from My shifts (holiday, unpaid, other); managers of the site approve or decline with a note, and see any rota shifts on those days. Approved time off shows as "Off" on the team rota, and shifts that clash are outlined for managers. The rota sheet is never changed by the app.
  - **Certificates**: food hygiene (Level 2 and 3), allergens, first aid, fire marshal and other training per person, with issue and expiry dates (expiry suggested from a 3-year refresher cycle). A matrix of who holds what, what's run out or running out, and whether each site has a first aider, a Level 3 supervisor and a fire marshal. Reminders at 9am, 30 and 7 days before and just after the date, to the person and their managers. **Right to work** checks are private to the owner (other owners and managers don't see them) and store dates, not document numbers. Nothing is deleted: a mistake is marked removed. Staff see their own certificates on My shifts.

- **Equipment and maintenance**: each site's register of kit (fridges, freezers, fryers, probes and so on) with where it is, who services it and how often. Anyone working at the site reports a problem from the tablet, their own phone, or by scanning the **QR label** on the kit (Manage → Equipment → Print QR labels); managers are told straight away. "Not working" kit shows at the top of Today and on the Handover tab until someone marks it fixed and says what was done. Managers log services; reminders go two weeks before a service is due and when it's overdue. The weekly report counts problems and hours out of service. The history is append-only and kit is retired, never deleted.

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
| `npm test` | Unit tests for the rules (temperatures, sign-off, access, rota, PINs, prep, records, reports, notices, time off, certificates, equipment, tasks) and the reminder scheduler on demo data |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run person:add` | Create or update a person, their site access and PIN (see above) |
| `node scripts/build-seed.mjs` | Regenerates `supabase/seed.sql` from `data/checklist-library.json` |

## How it's put together

- **Next.js 14 (App Router) + TypeScript.** Pages render on the server, and buttons call *server actions* (functions that run on the server, never in the browser).
- **`src/lib/domain/`** holds the business rules as plain functions with no database. This is the part the tests cover.
- **`src/lib/data/`** has a `Store` interface with two implementations: `DemoStore` (in memory) and `SqlStore` (Postgres/Supabase). The app uses `SqlStore` whenever `DATABASE_URL` is set.
- **`supabase/migrations/`** holds the database schema, one numbered file per change (`0001_core.sql` first). Row Level Security is on for every table with no policies, so the public Supabase API can read nothing; only the app server, connecting with the database connection string, can read or write. Checklist answers, corrective actions and the audit log are **append-only**: a database trigger refuses edits and deletes.
- **Sessions** are an httpOnly cookie checked on every request, so freezing someone or closing a site takes effect immediately.

## Security notes

- PINs are stored as scrypt hashes and compared in constant time. Owners cannot see PINs.
- Never commit `.env` files, staff names, phone numbers or PINs. Real staff data lives only in the database.
- Temperature limits in `temp_rules` are **placeholders until the owner confirms them** against the approved HACCP plan.
