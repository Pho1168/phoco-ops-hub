-- A handover list item can point at its recipe (a prep recipe in the library), so whoever picks it up from the
-- handover opens the recipe sheet in one tap. Set by managers on /manage/handover-list; audited.
alter table prep_items add column if not exists recipe_doc_id uuid references library_docs(id);
