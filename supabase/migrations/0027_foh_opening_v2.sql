-- FOH Opening, version 2 (owner, 14 Oct 2026): the owner's front-of-house opening checklist goes first, in four
-- sections, followed by the checks already in use, minus the five it now covers (menus on tables, air freshener in
-- the dining area, music, POS stock, polished glasses). Version 1 is retired; runs signed on it keep it.
-- A no-op on a database that doesn't have the checklist (a fresh seed).
do $$
declare v2 uuid; n int := 0;
begin
  if not exists (select 1 from checklist_templates where id = 'EAS-FOH-OPEN') then return; end if;
  if exists (select 1 from checklist_versions where template_id = 'EAS-FOH-OPEN' and version = 2) then return; end if;

  insert into checklist_versions (template_id, version, status, source_note)
    values ('EAS-FOH-OPEN', 2, 'draft', 'Owner''s FOH opening checklist first (4 sections, 17 checks); 5 duplicates dropped from the checks in use')
    returning id into v2;

  -- The owner's checklist.
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining room and toilets', 'Clean the front and back toilets', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining room and toilets', 'Wipe down all tables, chairs and sofas', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining room and toilets', 'Place a drinks menu on every table', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining room and toilets', 'Refill and tidy the cutlery holders', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining room and toilets', 'Open the blinds', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining room and toilets', 'Spray air freshener in the front area', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining room and toilets', 'Switch the music on', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type, hint) values (v2, n, 'Dining room and toilets', 'Open the front door', 'tick', 'At 11:55');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type, hint) values (v2, n, 'Drinks station', 'Prepare cups with lemon and condensed milk', 'tick', 'Takeaway and dine-in');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Drinks station', 'Cut fresh limes and restock mint', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Drinks station', 'Prepare and restock homemade drinks', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Drinks station', 'Restock canned drinks', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type, hint) values (v2, n, 'Drinks station', 'Restock chè ingredients', 'tick', 'Dessert and drinks');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Drinks station', 'Break or shave ice as needed', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Cutlery, glassware and utensils', 'Polish all cutlery, glasses and service utensils', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type, hint) values (v2, n, 'Cutlery, glassware and utensils', 'Return them to their stations', 'tick', 'Refill the water filter if needed');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Till and stock', 'Check the POS for items marked out of stock', 'tick');

  -- The checks already in use, in their order, without the five the block above now covers.
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining area', 'Straighten polaroids on the wall', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining area', 'Straighten chairs', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining area', 'Dim lights on, brightness set', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining area', 'Coat hanging area tidy', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Dining area', 'Air con settings checked', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Counter desk', 'PC, POS and delivery apps switched on', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Counter desk', 'Old receipts cleared', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type, hint) values (v2, n, 'Counter desk', 'No unprocessed sales left in POS', 'tick', 'If there are, tell the manager');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type, hint) values (v2, n, 'Bar and service', 'Beer tap on and set to level 7', 'tick', 'Level 7');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type, hint) values (v2, n, 'Bar and service', 'Pho condiments restocked', 'tick', 'Sweet chilli onion, hoisin, lime');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type, hint) values (v2, n, 'Bar and service', 'Drink mix jugs checked and restocked', 'tick', 'Coffee, lemonade, tea');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Bar and service', 'Che items restocked in fridge', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Bar and service', 'Dine-in cutlery and plates polished and restocked', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Bar and service', 'Takeaway packaging, cutlery and utensils restocked', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Bar and service', 'Dip saucers counted', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Customer toilet', 'Toilet roll restocked, 1 spare on the shelf', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Customer toilet', 'Hand soap restocked', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Customer toilet', 'Hot water working', 'tick');
  n := n + 1; insert into checklist_items (version_id, position, section, text, answer_type) values (v2, n, 'Customer toilet', 'Air freshener sprayed', 'tick');

  -- Version 2 goes live; version 1 is retired (its signed runs keep it).
  update checklist_versions set status = 'retired' where template_id = 'EAS-FOH-OPEN' and status = 'published';
  update checklist_versions set status = 'published', published_at = now() where id = v2;
end $$;
