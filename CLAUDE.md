# Notes for working on this repo

- Product owner: the PHO & CO owner. Confirm any new feature idea with them before building it.
- Sites: EAS (Eastcote, restaurant), WEM (Wembley, production, Reg 853 approved), SYD (Sydenham, closed until it reopens and left out of the pilot).
- Keep business rules in `src/lib/domain/`, pure and tested. UI and actions call them; they never re-implement them.
- Every data change goes through `Store` (`src/lib/data/store.ts`). Add the method to the interface, `demo-store.ts` and `sql-store.ts`.
- Server actions in `src/app/actions.ts` must check the session (`requireCtx` / `requireOwner`), validate input with zod and write an audit entry for anything a manager or an inspector would care about.
- Food-safety records are append-only. Correct by adding a new entry, never by editing.
- No staff personal data, PINs or secrets in the repo. Demo people are labelled "(demo)".
- Before pushing, run `npm run typecheck && npm run lint && npm test && npm run build`.
- Brand: cream `#F6F1E7`, green `#2F4A3A`, sage `#DCE3D6`, orange `#C2611A`. Fonts Barlow Condensed (headings), Be Vietnam Pro (body).
- Database: Supabase project `phoco-ops-hub` (ref iklgabptdlwjwwngepyc, eu-west-2 London). The org's other project ("Pho & Co's Project") is a separate purchase-ledger app: never touch it.
- Schema changes go in a new numbered file in `supabase/migrations/` and are applied to Supabase too.
- Rota: the app never writes to the rota sheets. Imports arrive at `/api/rota/import` (per-site token, hashed in `rota_sources`). Rules in `src/lib/domain/rota.ts`; times are London wall-clock (`src/lib/domain/time.ts`).
- Secrets the server generates (VAPID push keys, scheduler token) live in `app_secrets`; the Supabase cron job `ops-hub-reminders` reads the `cron` token from there.
