import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import Link from "next/link";
import { latestAnswers, progress, runState } from "@/lib/domain/checklist";
import { describeRule } from "@/lib/domain/temperature";
import { londonNow, requireCtx } from "@/lib/session";
import { TopBar } from "@/components/Chrome";
import { RunClient, type RunItemView } from "./RunClient";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, { warn: string[]; bad: string[]; warnMsg: string; badMsg: string }> = {
  F: { warn: ["Door closed, re-check in 30 min", "Moved food to another fridge"], bad: ["Moved food to another fridge", "Food discarded", "Engineer called"],
       warnMsg: "Above target. Close the door and re-check in 30 minutes.", badMsg: "Above the legal limit. What did you do with the food?" },
  Z: { warn: ["Seal checked, re-check in 30 min", "Moved food to another freezer"], bad: ["Moved food to another freezer", "Food discarded", "Engineer called"],
       warnMsg: "Warmer than target. Check the door seal and re-check in 30 minutes.", badMsg: "Warmer than the safe limit. What did you do with the food?" },
  C: { warn: [], bad: ["Cooked longer and re-probed", "Food discarded"], warnMsg: "", badMsg: "Below the safe core temperature. Do not serve. Keep cooking and probe again." },
};

export default async function RunPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx();
  const db = store();
  const list = await db.checklist(params.id);
  if (!list || list.siteId !== ctx.site.id) notFound();
  const rules = await db.rules();
  const { date, hm } = londonNow();
  const run = await db.run(list.id, date);
  const latest = latestAnswers(run.answers);
  const p = progress(list, run.answers);
  const state = runState(p, !!run.signedAt, list.due, hm);
  const signer = run.signedBy ? await db.person(run.signedBy) : undefined;

  const items: RunItemView[] = list.items.map((it) => {
    const a = latest.get(it.id);
    const rule = it.ruleCode ? rules[it.ruleCode] : undefined;
    const acts = it.ruleCode ? ACTIONS[it.ruleCode] : undefined;
    return {
      id: it.id, section: it.section, text: it.text, type: it.type, tag: it.tag, freezer: it.type === "temp" && it.ruleCode === "Z",
      meta: [rule ? describeRule(rule) : it.hint, it.tag === "new" ? "suggested" : it.tag].filter(Boolean).join(" · "),
      value: a?.value ?? "", outcome: a?.outcome ?? "todo", action: a?.action,
      warnActions: acts?.warn ?? [], badActions: acts?.bad ?? [], warnMsg: acts?.warnMsg ?? "", badMsg: acts?.badMsg ?? "",
    };
  });

  return (
    <>
      <TopBar ctx={ctx} title={list.name} eyebrow={`${ctx.site.name} · ${list.when}${list.due ? ` · due ${list.due}` : ""}`} back="/today">
        {state === "overdue" && <span className="chip late">Late</span>}
        {state === "done" && <span className="chip done">Signed off</span>}
        {!run.signedAt && <Link className="pill-btn top-extra" href="/handover">Report issue</Link>}
      </TopBar>
      <RunClient
        listId={list.id} name={list.name} siteName={ctx.site.name} when={list.when} due={list.due} suggested={list.suggested}
        items={items} answered={p.answered} total={p.total} needsAction={p.needsAction}
        signed={run.signedAt ? { by: signer?.name ?? "", at: new Date(run.signedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) } : null}
      />
    </>
  );
}
