-- Eastcote's opening checks were due at 11:00, the minute the kitchen and front of house arrive.
-- Doors open at 12:00 (sites.ready_by), so they're now due 11:45: 45 minutes to do them, done before the first customer.
-- Cooking Temps (12:00) is the first cook check, not an opening one, and stays.
-- Wembley is unchanged (owner's decision, 14 Oct 2026).
update checklist_templates set due_time = '11:45' where id in ('EAS-FOH-OPEN', 'EAS-BOH-OPEN', 'EAS-TEMP-COLD');
