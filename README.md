# PHO & CO Ops Hub

Operations app for PHO & CO restaurants (Eastcote, Sydenham) and the Wembley central production kitchen.
Built for shared Android phones and tablets on site: staff pick their name, enter a PIN and work through
the day's checklists. Owners see every site, resolve alerts and control accounts; operations managers do most of
that for the sites they run.

## What works today

- **Site tablets only**: staff names and the name + PIN sign-in appear only on tablets registered to a site with a one-time set-up code from an owner or operations manager. Any other device shows no names, just a pairing box and a staff ID + PIN sign-in (the full app for owners and operations managers, My shifts for everyone else). Removing a tablet signs out everyone on it.
- **Sign in** with name + 4-digit PIN. 5 wrong PINs (at sign-in, sign-off or PIN change) locks the account for 15 minutes.
- **Staff management** (owners, and operations managers for staff and managers at their sites): add people, sites, roles, sections; temporary PINs that must be changed on first use; reset PIN; mark as left.
- **Roles**, set per site: **staff**, **manager** (manager tools for their site), **operations manager** and **owner**.
  - An **operations manager** runs a group of sites, above the site managers and below the owner. At their sites they have everything a manager has, plus the overview (Overview tab: the sites, today's team and **Send reminders now**, alerts, the activity log), staff and manager accounts (add, edit, temporary PIN, log out, freeze, mark as left) and the shop tablets (set up and remove). They get the full app on their own phone or laptop, and every manager message for their sites (alerts, gas, ready to open, cover, time off, the 08:00 and Monday summaries).
  - These stay with the **owner**: closing and reopening sites (and anything that would lift a closure's freeze: unfreezing, or marking as left and rejoining), connecting rota sheets, right to work, owner and operations manager accounts (including the operations manager's own) and the account of anyone allowed to see right to work, anyone who also works at a site the operations manager doesn't run, and making anyone an owner or operations manager. An operations manager's own time off goes to the owners only (site managers don't see the request), "All sites" notices need someone who manages every site (a closed one included), and their activity log leaves out other sites and right to work. Signing in by staff ID on their own device lands at an open site they run.
- **Today screen**: the site's checklists for each section (FOH, BOH, Production) with due times, overdue flags, open alerts and handover items.
- **Checklists**: tick items, temperature readings, numbers, text, photo placeholders. Readings are checked against the approved limits:
  - Fridge: target ≤ 5 °C, legal limit 8 °C
  - Freezer: target ≤ −18 °C (warning only)
  - Cooking: core ≥ 75 °C
  An out-of-range reading must have a corrective action before the list can be signed off, and a failed one raises an alert for managers.
- **Sign-off** requires the PIN again. Signed records are locked; corrections are added as new entries.
- **Handover** notes between shifts. "Needs action" items stay open until someone closes them.
- **Owner control** (the overview; operations managers see their own sites, without closing them):
  - site overview
  - resolve alerts (a note is required)
  - log out or freeze any account
  - **close a site with one button**, which logs everyone out there and freezes staff who only work at that site; reopening unfreezes them
  - audit trail of every action

- **Rota and reminders**: each site's rota Google Sheet sends its Export, week status (Settings) and Staff tabs every hour through a small Apps Script (Owner → Rota sheets → Connect sheet). Only Published weeks are shown or messaged. Staff sign in on their own phone with staff ID + PIN to a limited **My shifts** view and turn on notifications: a list when a week is published, a message when a published shift changes, and a reminder at 18:00 the evening before. Nothing is sent 22:00–08:00, except urgent messages (kit not working, P1 tasks), which still go out until midnight, and shift reminders (below). A Supabase schedule (pg_cron) calls `/api/cron/tick` every 10 minutes.
- **Shift reminders and replies**: every published shift gets one reminder 2 hours before it starts (not before 05:00 unless the shift starts earlier), whatever the hour. It carries what's waiting from handover at the site: action notes (staff notes never; customer complaints only as a count, since they can name a customer) and prep still to do. The owner's **Send reminders now** button (top of the Owner screen) sends them straight away to everyone starting later today who hasn't had theirs, and shows today's team at every site, who has notifications on, and each reply. Staff answer under the shift on My shifts: **On my way**, **Running late** (15, 30 or 45 min) or **Can't make it** (they're also asked to phone). Late and can't-make-it replies go to the site's managers and owners straight away (if the shift starts within 3 hours, even at night) and show at the top of Today for managers. Replies are append-only: a new one replaces the last.

- **Handover tab** (prep and notes in one place): everything outstanding for the shift on one list, prep items from the last handover and notes together, each ticked Done (who and when are kept; undo within 10 minutes). Notes can be added at any time and show straight away: **Needs action** notes stay until ticked, **For info** notes show for that shift and the next, then drop off. Food-safety notes go to the top. At Eastcote the closing shift also does the **prep handover** from the same tab: one master list of 63 items, tap only what's needed (saved as a shared draft), Next shift / Tomorrow morning / Tomorrow evening, then "everything else is stocked". Anything not done carries into the next handover once, and the manager gets an alert.

- **Ready to open** (Today and the Owner screen): each site has a ready time (Eastcote 12:00, Wembley 08:00, in `sites.ready_by`). On a day the site has published shifts (and once it has started recording checklists in the app) it shows a light. **Green**: the opening checks (those due by the ready time) are signed and nothing is in the way. **Amber**: still getting ready, or kit not working, a warning alert, or someone late or not coming. **Red**: opening checks unsigned at the ready time, food-safety kit not working, or a critical alert. Red at the ready time messages the site's managers and owners once, with why.
- **Gas off at close**: from 15 minutes before the last published shift at a site ends, the tablet and the closing team's phones show **All gas is off**. The first tap counts (who, when, and whether on the tablet or a phone; it can't be changed). If nobody has tapped 30 minutes after close, the site's managers and owners are told, whatever the hour, and hear when it's done. Only on days with published shifts, so a site whose rota isn't in the app yet (Wembley today) is never chased.
- **Yesterday at a glance**: at 08:00 owners (all sites) and managers (their sites) get one message covering checks signed and missed, temperatures out of range, alerts, kit, people late or not coming, handover notes, overdue tasks, and whether the gas check was done. Sites that weren't in use that day are left out.
- **Shift cover**: under any upcoming published shift on My shifts, **Ask for cover** (with an optional reason, which only managers see). Colleagues at the same site in the same section who aren't working (or already covering) then and aren't off are asked; the site's managers and owners are told. Colleagues see it under **Shifts you could cover** and tap **I can cover** (or take it back). A manager approves one offer (Manage → Shift cover) or declines with a note, and can cancel an approval later; everyone involved is told. The app never changes the rota sheet: the page tells the manager to move the shift in the sheet, and once the next import shows it moved, the request shows as covered. If the sheet changes the shift first, an open request closes. Requests can be withdrawn while open; nothing is deleted.
- **Team rota** (Rota tab, and "Team rota" on My shifts): the site's week laid out like the Schedule tab in the rota sheet, a grid on a computer and day by day on a phone. Everyone at the site can see published weeks; owners and managers also see paid hours, daily and weekly totals, and draft weeks (marked Draft). Paid hours come from the sheet's Export tab with each hourly sync.

- **Manager tools** (Manage tab for managers; tiles at the top of the overview for owners and operations managers). Managers use them on the shop tablet; staff phones stay limited to My shifts and the team rota.
  - **Task centre**: everything open at the sites a manager runs, in one list by priority (P1 critical to P4 improvement): critical alerts and broken fridges first, then overdue checklists, food-safety handover actions, urgent prep, run-out certificates, and so on. Managers add one-off tasks for a person, a section or everyone at a site, with a date; they show on Today (and My shifts on a phone) for the people they're for, who tick them done with a note (undo within 10 minutes). Alerts can be resolved from here. Everything else links to where it's dealt with.
  - **Inspection records**: for a site and date range, the temperature log (with limits, out-of-range readings and corrective actions), checklist sign-offs (on time, late, not signed), alerts with how they were resolved, and food-safety handover notes. Printable, with CSV downloads. Days before a site's first recorded checklist aren't counted as missed.
  - **Weekly report**: per site and for the group, Monday to Sunday: checklists on time, temperatures out of range, alerts, handover actions, prep carried over and planned hours, with a change on the week before and a short "needs attention" list in plain words. On Monday at 9am each owner and manager also gets last week's headline numbers for their sites as a message.
  - **Team notices**: post to a site (or every site, for someone who manages them all, closed ones included), optionally only FOH, BOH or PROD, with an end date. Everyone it's for sees it on Today or My shifts until they tap "Got it"; the poster sees who has and hasn't. Important notices also go to phones with notifications on.
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

Access is `SITE:role:SECTIONS`, separated by `;`. Roles are owner, ops (operations manager), manager and staff. Sections are FOH, BOH and PROD.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests for the rules (temperatures, sign-off, access, rota, PINs, prep, records, reports, notices, time off, certificates, equipment, tasks, shift reminders and replies) and the reminder scheduler on demo data |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run person:add` | Create or update a person, their site access and PIN (see above) |
| `node scripts/build-seed.mjs` | Regenerates `supabase/seed.sql` from `data/checklist-library.json` |

## How it's put together

- **Next.js 15 (App Router) + React 19 + TypeScript.** Pages render on the server, and buttons call *server actions* (functions that run on the server, never in the browser). In Next.js 15, `params`, `searchParams`, `cookies()` and `headers()` are asynchronous: always `await` them.
- **`src/lib/domain/`** holds the business rules as plain functions with no database. This is the part the tests cover.
- **`src/lib/data/`** has a `Store` interface with two implementations: `DemoStore` (in memory) and `SqlStore` (Postgres/Supabase). The app uses `SqlStore` whenever `DATABASE_URL` is set.
- **`supabase/migrations/`** holds the database schema, one numbered file per change (`0001_core.sql` first). Row Level Security is on for every table with no policies, so the public Supabase API can read nothing; only the app server, connecting with the database connection string, can read or write. Checklist answers, corrective actions and the audit log are **append-only**: a database trigger refuses edits and deletes.
- **Sessions** are an httpOnly cookie checked on every request, so freezing someone or closing a site takes effect immediately.

## Security notes

- PINs are stored as scrypt hashes and compared in constant time. Owners cannot see PINs.
- Never commit `.env` files, staff names, phone numbers or PINs. Real staff data lives only in the database.
- Temperature limits in `temp_rules` are **placeholders until the owner confirms them** against the approved HACCP plan.
