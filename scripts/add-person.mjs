#!/usr/bin/env node
// Create or update a person and their site access, then set their PIN.
// Used to create the first owner account; after that, people are managed in the app.
//
//   DATABASE_URL=... node scripts/add-person.mjs --code PC-0001 --name "First name" \
//     --access "EAS:owner:FOH,BOH;WEM:owner:PROD;SYD:owner"
//
// The PIN is asked for privately (or read from the PIN environment variable) and only a hash is stored.
import { randomBytes, scryptSync } from "node:crypto";
import { parseArgs } from "node:util";
import postgres from "postgres";

const { values } = parseArgs({ options: { code: { type: "string" }, name: { type: "string" }, access: { type: "string" } } });
const fail = (m) => { console.error(m); process.exit(1); };
if (!process.env.DATABASE_URL) fail("Set DATABASE_URL first.");
if (!/^PC-\d{4}$/.test(values.code ?? "")) fail("--code must look like PC-0001");
if (!values.name?.trim()) fail("--name is required");

const SITES = ["EAS", "WEM", "SYD"], ROLES = ["owner", "manager", "staff"], AREAS = ["FOH", "BOH", "PROD"];
const access = (values.access ?? "").split(";").filter(Boolean).map((part) => {
  const [site, role, sections = ""] = part.split(":");
  if (!SITES.includes(site) || !ROLES.includes(role)) fail(`Bad access entry "${part}". Use SITE:role:SECTIONS`);
  const secs = sections.split(",").filter(Boolean);
  if (secs.some((s) => !AREAS.includes(s))) fail(`Bad section in "${part}"`);
  return { site, role, secs };
});
if (!access.length) fail("--access is required");

async function readPin() {
  if (process.env.PIN) return process.env.PIN;
  process.stdout.write("PIN (4 digits, not shown): ");
  const stdin = process.stdin;
  stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding("utf8");
  let pin = "";
  return new Promise((resolve) => {
    stdin.on("data", (ch) => {
      if (ch === "\r" || ch === "\n") { stdin.setRawMode?.(false); stdin.pause(); process.stdout.write("\n"); resolve(pin); }
      else if (ch === "\u0003") process.exit(1);
      else if (ch === "\u007f") pin = pin.slice(0, -1);
      else pin += ch;
    });
  });
}

const pin = await readPin();
// Same rules as src/lib/domain/pin.ts
if (!/^\d{4}$/.test(pin) || /^(\d)\1+$/.test(pin) || ["1234", "4321", "0123", "1212", "2580", "0852"].includes(pin)) fail("PIN too weak: use 4 digits, not repeated or an easy pattern.");
const salt = randomBytes(16);
const pinHash = `scrypt$${salt.toString("hex")}$${scryptSync(pin, salt, 32).toString("hex")}`;

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
try {
  await sql.begin(async (tx) => {
    const [p] = await tx`
      insert into people (staff_code, display_name, pin_hash) values (${values.code}, ${values.name.trim()}, ${pinHash})
      on conflict (staff_code) do update set display_name = excluded.display_name, pin_hash = excluded.pin_hash,
        pin_failed = 0, pin_locked_until = null
      returning id`;
    await tx`delete from person_sites where person_id = ${p.id}`;
    for (const a of access) await tx`insert into person_sites (person_id, site_id, role, sections) values (${p.id}, ${a.site}, ${a.role}, ${a.secs})`;
    await tx`insert into audit_log (actor_id, action, entity, entity_id, detail) values (${p.id}, 'person.setup', 'person', ${p.id}, ${tx.json({ text: `Account set up from the command line (${values.code})` })})`;
  });
  console.log(`Saved ${values.code} with access ${access.map((a) => `${a.site} ${a.role}`).join(", ")}.`);
} finally {
  await sql.end();
}
