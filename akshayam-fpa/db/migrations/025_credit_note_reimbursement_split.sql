-- ============================================================
-- Which side of the ledger a credit note actually reverses.
--
-- invoice_lines and payments have carried is_reimbursement since 003 - an
-- RI- prefixed document is a recharge of a client-paid cost, never fee
-- income. Credit notes never got the same flag, so a credit note raised
-- against an RI invoice (Zoho's own convention prefixes these RICN-) was
-- netted against fee revenue like any other, understating fee income and
-- leaving reimbursement income overstated by exactly the same amount.
--
-- Same rule, same column name, same reasoning as 003: derived from the
-- invoice_number the credit note was raised against, not from the credit
-- note's own RICN- number - a firm that stopped following that naming
-- convention would silently break a check against it, where the invoice
-- linkage is the actual fact being represented.
-- ============================================================

alter table credit_notes add column if not exists is_reimbursement boolean not null default false;

comment on column credit_notes.is_reimbursement is
  'Credit note raised against a reimbursement invoice (RI- prefix): reduces reimbursement income, not fee income.';

update credit_notes
   set is_reimbursement = true
 where invoice_number like 'RI-%'
   and not is_reimbursement;
