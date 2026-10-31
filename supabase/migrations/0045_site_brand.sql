-- Each site trades under a business (brand): PHO & CO, or Cafe La Viet (Colindale). The app shows that business's
-- name, logo and colours to whoever works there. Everything behind it (handover list, library, training, stock) is shared.
alter table sites add column if not exists brand text not null default 'phoco' check (brand in ('phoco', 'clv'));
update sites set brand = 'clv' where id = 'CLV';
