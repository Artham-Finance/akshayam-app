-- ============================================================
-- Reimbursements, read as a cost: "Net Reimbursable Cost (RE − RI)".
--
-- The P&L carried this group as "Reimbursable Costs Recovered (net)" - income
-- less expense, a recovery positive and added. Everything else the firm reads
-- on that statement is a cost shown positive and subtracted (Overheads, OSB
-- Expenses), and its own working is "GP less Overheads less net reimbursable
-- cost (RE − RI) less OSB, add Other income". The line now follows that: reimbursement
-- expense less reimbursement income, shown positive when it is a cost and in
-- brackets when income exceeds it.
--
-- Display only. Stored values are credit less debit, as for every group, and
-- the subtotals are plain sums of them - so EBITDA and everything below it are
-- unchanged to the rupee; only the sign the line is shown with flips.
-- ============================================================

update report_groups
   set name = 'Net Reimbursable Cost (RE − RI)',
       sign = -1
 where statement = 'pnl' and code = 'reimbursements';
