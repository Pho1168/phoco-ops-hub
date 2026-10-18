-- Freezers get a safe limit: -15°C. Readings colder than -18°C are on target; -18°C to -15°C are recorded as above
-- target (the checklist asks for a re-check) but raise no alert; warmer than -15°C is past the limit, raises an alert
-- and asks what was done with the food. Fridges keep theirs (5°C target, 8°C limit). Alerts are only raised past a
-- limit (answerItem in src/app/actions.ts). Placeholder limits until the owner confirms them against the HACCP plan.

update temp_rules set legal_max = -15 where code = 'Z' and legal_max is null;
