-- Handover list regrouped by station (owner, 14 Oct 2026). "Bar & counter" came from the retired Bar & Counter
-- Prep checklist and Eastcote has no bar or counter: its to-do items go into three station groups, its prep items
-- are kitchen prep under another name (five duplicates taken off the list, six moved into the kitchen groups), and
-- the kitchen groups are split by station. Ids never change; retired items keep their position and can be put back.
-- A no-op on a database without these items.

-- To do: three station groups.
update prep_items set grp = 'Drinks & packaging', position = 75 where id = 'kp-077'; -- Restock drinks
update prep_items set grp = 'Drinks & packaging', position = 76 where id = 'kp-085'; -- Restock che
update prep_items set grp = 'Drinks & packaging', position = 77 where id = 'kp-084'; -- Check mix jugs
update prep_items set grp = 'Drinks & packaging', position = 78 where id = 'kp-083'; -- Refill and freeze water containers
update prep_items set grp = 'Drinks & packaging', position = 79 where id = 'kp-076'; -- Restock packaging
update prep_items set grp = 'Condiments & sauces', position = 80 where id = 'kp-075'; -- Check sweet chilli onions
update prep_items set grp = 'Condiments & sauces', position = 81 where id = 'kp-082'; -- Restock sauces
update prep_items set grp = 'Banh mi fillings', position = 82 where id = 'kp-078'; -- Check banh mi stock
update prep_items set grp = 'Banh mi fillings', position = 83 where id = 'kp-079'; -- Check house mayo
update prep_items set grp = 'Banh mi fillings', position = 84 where id = 'kp-080'; -- Restock pickle
update prep_items set grp = 'Banh mi fillings', position = 85 where id = 'kp-081'; -- Restock pate

-- To prep: eight station groups.
update prep_items set grp = 'Fryers & oil', position = 1 where id = 'kp-001';
update prep_items set grp = 'Fryers & oil', position = 2 where id = 'kp-002';
update prep_items set grp = 'Fryers & oil', position = 3 where id = 'kp-003';
update prep_items set grp = 'Cooking', position = 4 where id = 'kp-004'; -- Cook bun
update prep_items set grp = 'Cooking', position = 5 where id = 'kp-072'; -- Portion bun (was Bar & counter)
update prep_items set grp = 'Cooking', position = 6 where id = 'kp-005'; -- Cook prawns
update prep_items set grp = 'Cooking', position = 7 where id = 'kp-006'; -- Soak pho noodles
update prep_items set grp = 'Cooking', position = 8 where id = 'kp-007'; -- Cook rice
update prep_items set grp = 'Cooking', position = 9 where id = 'kp-017'; -- Vegetarian pho
update prep_items set grp = 'Cooking', position = 10 where id = 'kp-008'; -- Smash ice
update prep_items set grp = 'Fried & marinated chicken', position = 11 where id = 'kp-009';
update prep_items set grp = 'Fried & marinated chicken', position = 12 where id = 'kp-010';
update prep_items set grp = 'Fried & marinated chicken', position = 13 where id = 'kp-011';
update prep_items set grp = 'Fried & marinated chicken', position = 14 where id = 'kp-012';
update prep_items set grp = 'Fried & marinated chicken', position = 15 where id = 'kp-013';
update prep_items set grp = 'Banh mi meats', position = 16 where id = 'kp-014';
update prep_items set grp = 'Banh mi meats', position = 17 where id = 'kp-015';
update prep_items set grp = 'Banh mi meats', position = 18 where id = 'kp-016';
update prep_items set grp = 'Fresh prep & vegetables', position = 19 where id = 'kp-018'; -- Salad
update prep_items set grp = 'Fresh prep & vegetables', position = 20 where id = 'kp-019'; -- Bun/rice – cucumber
update prep_items set grp = 'Fresh prep & vegetables', position = 21 where id = 'kp-020'; -- Pho – spring onion
update prep_items set grp = 'Fresh prep & vegetables', position = 22 where id = 'kp-021'; -- Pho – onion
update prep_items set grp = 'Fresh prep & vegetables', position = 23 where id = 'kp-022'; -- Pho – coriander
update prep_items set grp = 'Fresh prep & vegetables', position = 24 where id = 'kp-069'; -- Pick coriander leaves (was Bar & counter)
update prep_items set grp = 'Fresh prep & vegetables', position = 25 where id = 'kp-065'; -- Cut coriander stalks to length (was Bar & counter)
update prep_items set grp = 'Fresh prep & vegetables', position = 26 where id = 'kp-070'; -- Pick mint leaves (was Bar & counter)
update prep_items set grp = 'Fresh prep & vegetables', position = 27 where id = 'kp-071'; -- Cut romaine to size (was Bar & counter)
update prep_items set grp = 'Fresh prep & vegetables', position = 28 where id = 'kp-023'; -- Rice – red cabbage
update prep_items set grp = 'Fresh prep & vegetables', position = 29 where id = 'kp-024'; -- Rice – white cabbage
update prep_items set grp = 'Fresh prep & vegetables', position = 30 where id = 'kp-025'; -- Rice – shredded carrot (pickle)
update prep_items set grp = 'Fresh prep & vegetables', position = 31 where id = 'kp-026'; -- Papaya
update prep_items set grp = 'Fresh prep & vegetables', position = 32 where id = 'kp-030'; -- Carrot – papaya
update prep_items set grp = 'Fresh prep & vegetables', position = 33 where id = 'kp-031'; -- Carrot – shred
update prep_items set grp = 'Fresh prep & vegetables', position = 34 where id = 'kp-027'; -- Lime wedges
update prep_items set grp = 'Fresh prep & vegetables', position = 35 where id = 'kp-028'; -- Pickles
update prep_items set grp = 'Fresh prep & vegetables', position = 36 where id = 'kp-029'; -- Pickled onions
update prep_items set grp = 'Fresh prep & vegetables', position = 37 where id = 'kp-032'; -- Banh mi/summer roll – spring onion
update prep_items set grp = 'Fresh prep & vegetables', position = 38 where id = 'kp-033'; -- Banh mi – red chilli
update prep_items set grp = 'Fresh prep & vegetables', position = 39 where id = 'kp-034'; -- Banh mi/summer roll – cucumber
update prep_items set grp = 'Sauces & condiments', position = 40 where id = 'kp-035';
update prep_items set grp = 'Sauces & condiments', position = 41 where id = 'kp-036';
update prep_items set grp = 'Sauces & condiments', position = 42 where id = 'kp-037';
update prep_items set grp = 'Sauces & condiments', position = 43 where id = 'kp-038';
update prep_items set grp = 'Sauces & condiments', position = 44 where id = 'kp-039';
update prep_items set grp = 'Sauces & condiments', position = 45 where id = 'kp-040';
update prep_items set grp = 'Defrosting & refills', position = 46 where id = 'kp-041';
update prep_items set grp = 'Defrosting & refills', position = 47 where id = 'kp-042';
update prep_items set grp = 'Defrosting & refills', position = 48 where id = 'kp-043';
update prep_items set grp = 'Defrosting & refills', position = 49 where id = 'kp-044';
update prep_items set grp = 'Defrosting & refills', position = 50 where id = 'kp-045';
update prep_items set grp = 'Defrosting & refills', position = 51 where id = 'kp-046';
update prep_items set grp = 'Defrosting & refills', position = 52 where id = 'kp-047';
update prep_items set grp = 'Defrosting & refills', position = 53 where id = 'kp-048';
update prep_items set grp = 'Defrosting & refills', position = 54 where id = 'kp-049';
update prep_items set grp = 'Defrosting & refills', position = 55 where id = 'kp-050';
update prep_items set grp = 'Defrosting & refills', position = 56 where id = 'kp-051';
update prep_items set grp = 'Defrosting & refills', position = 57 where id = 'kp-052';
update prep_items set grp = 'Defrosting & refills', position = 58 where id = 'kp-053';
update prep_items set grp = 'Defrosting & refills', position = 59 where id = 'kp-054';
update prep_items set grp = 'Drinks & desserts', position = 60 where id = 'kp-055';
update prep_items set grp = 'Drinks & desserts', position = 61 where id = 'kp-056';
update prep_items set grp = 'Drinks & desserts', position = 62 where id = 'kp-057';
update prep_items set grp = 'Drinks & desserts', position = 63 where id = 'kp-058';
update prep_items set grp = 'Drinks & desserts', position = 64 where id = 'kp-059';
update prep_items set grp = 'Drinks & desserts', position = 65 where id = 'kp-060';
update prep_items set grp = 'Drinks & desserts', position = 66 where id = 'kp-061';
update prep_items set grp = 'Drinks & desserts', position = 67 where id = 'kp-062';
update prep_items set grp = 'Drinks & desserts', position = 68 where id = 'kp-063';
update prep_items set grp = 'Drinks & desserts', position = 69 where id = 'kp-073'; -- Slice lemons (was Bar & counter)

-- Duplicates of kitchen prep, taken off the list (not deleted; the owner can put them back).
update prep_items set active = false, retired_at = now(), grp = 'Fresh prep & vegetables'
  where id in ('kp-064', 'kp-066', 'kp-067', 'kp-068') and active; -- limes, cucumber, chillies, spring onions
update prep_items set active = false, retired_at = now(), grp = 'Cooking' where id = 'kp-074' and active; -- Break ice (= Smash ice)
