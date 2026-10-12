-- Where a phone notification opens when tapped (a page in the app). Empty: My shifts.
alter table notifications add column if not exists url text
  check (url is null or (char_length(url) <= 200 and url like '/%' and url not like '//%'));
