-- ============================================================
-- What a receipt was actually worth in the currency it arrived in.
--
-- payments.amount_base is the INR figure Zoho converts to, which is the right
-- basis for every total in the app. It is not, however, the figure the client
-- paid: an Akshayam GIFT-city client remits dollars, and "collected 15.4 lakh"
-- answers a different question from "collected 16,200 dollars".
--
-- The Zoho export carries both - a column named after the currency alongside
-- bcy_amount - so the foreign figure was there all along and simply was not
-- being kept. Null on an INR receipt, where it would only repeat amount_base.
-- ============================================================

alter table payments add column if not exists amount_foreign numeric(18,2);
