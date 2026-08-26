-- ============================================================
-- Seed: the two group entities and the statement layouts.
--
-- Sign convention (important):
--   P&L  amounts are computed as  credit - debit  -> income positive, costs negative
--   BS   amounts are computed as  debit - credit  -> assets positive, liab/equity negative
--   report_groups.sign = -1 means "flip for display", so a cost group shows
--   as a positive number but still subtracts correctly in the subtotals.
--   Subtotals therefore just add the raw signed values - no special casing.
--
-- P&L structure follows the firm's own reporting convention:
--   direct costs   = consultancy charges, VPP, professional fees, staff salary
--   establishment  = office rent, electricity, building maintenance
--   overheads      = everything else
--   reimbursements = MCA fees paid by card and recharged to clients, shown net
--   drawings       = partners' drawings, below PAT and outside EBITDA
-- ============================================================

insert into entities (slug, name, currency, fy_start_month) values
  ('rbjv',     'RBJV & Associates',                  'INR', 4),
  ('akshayam', 'Akshayam Corporate Private Limited', 'INR', 4);

-- ---------- Profit & Loss (both entities) ----------

insert into report_groups (entity_id, statement, code, name, sort_order, is_subtotal, subtotal_of, sign)
select e.id, v.statement::statement_kind, v.code, v.name, v.sort_order, v.is_subtotal, v.subtotal_of, v.sign
from entities e,
(values
  ('pnl', 'revenue',            'Revenue from Operations',            10,  false, null::text[],                                                                            1),
  ('pnl', 'direct_cost',        'Direct Costs',                       20,  false, null,                                                                                  -1),
  ('pnl', 'gross_profit',       'Gross Profit',                       30,  true,  array['revenue','direct_cost'],                                                          1),
  ('pnl', 'establishment_cost', 'Establishment Cost',                 40,  false, null,                                                                                  -1),
  ('pnl', 'overheads',          'Overheads',                          50,  false, null,                                                                                  -1),
  ('pnl', 'reimbursements',     'Reimbursable Costs Recovered (net)', 60,  false, null,                                                                                    1),
  ('pnl', 'other_income',       'Other Income',                       70,  false, null,                                                                                    1),
  ('pnl', 'ebitda',             'EBITDA',                             80,  true,  array['gross_profit','establishment_cost','overheads','reimbursements','other_income'],   1),
  ('pnl', 'depreciation',       'Depreciation & Amortisation',        90,  false, null,                                                                                  -1),
  ('pnl', 'ebit',               'EBIT',                              100,  true,  array['ebitda','depreciation'],                                                          1),
  ('pnl', 'finance_cost',       'Finance Costs',                     110,  false, null,                                                                                  -1),
  ('pnl', 'pbt',                'Profit Before Tax',                 120,  true,  array['ebit','finance_cost'],                                                            1),
  ('pnl', 'tax',                'Tax Expense',                       130,  false, null,                                                                                  -1),
  ('pnl', 'pat',                'Profit After Tax',                  140,  true,  array['pbt','tax'],                                                                      1),
  ('pnl', 'partner_drawings',   'Partners'' Drawings',               150,  false, null,                                                                                  -1),
  ('pnl', 'retained_profit',    'Retained Profit',                   160,  true,  array['pat','partner_drawings'],                                                         1)
) as v(statement, code, name, sort_order, is_subtotal, subtotal_of, sign);

-- ---------- Balance Sheet (both entities) ----------

insert into report_groups (entity_id, statement, code, name, sort_order, is_subtotal, subtotal_of, sign)
select e.id, v.statement::statement_kind, v.code, v.name, v.sort_order, v.is_subtotal, v.subtotal_of, v.sign
from entities e,
(values
  ('bs', 'fixed_assets',  'Property, Plant & Equipment',  10,  false, null::text[],                                                            1),
  ('bs', 'intangibles',   'Intangible Assets',            20,  false, null,                                                                    1),
  ('bs', 'investments',   'Investments',                  30,  false, null,                                                                    1),
  ('bs', 'other_nca',     'Other Non-Current Assets',     40,  false, null,                                                                    1),
  ('bs', 'total_nca',     'Total Non-Current Assets',     50,  true,  array['fixed_assets','intangibles','investments','other_nca'],            1),
  ('bs', 'receivables',   'Trade Receivables',            60,  false, null,                                                                    1),
  ('bs', 'cash',          'Cash & Bank Balances',         70,  false, null,                                                                    1),
  ('bs', 'other_ca',      'Other Current Assets',         80,  false, null,                                                                    1),
  ('bs', 'total_ca',      'Total Current Assets',         90,  true,  array['receivables','cash','other_ca'],                                   1),
  ('bs', 'total_assets',  'TOTAL ASSETS',                100,  true,  array['total_nca','total_ca'],                                            1),
  ('bs', 'equity',        'Partners''/Share Capital',    110,  false, null,                                                                   -1),
  ('bs', 'reserves',      'Reserves & Surplus',          120,  false, null,                                                                   -1),
  ('bs', 'borrowings',    'Borrowings',                  130,  false, null,                                                                   -1),
  ('bs', 'payables',      'Trade Payables',              140,  false, null,                                                                   -1),
  ('bs', 'other_liab',    'Other Liabilities & Provisions', 150, false, null,                                                                  -1),
  ('bs', 'total_eq_liab', 'TOTAL EQUITY & LIABILITIES',  160,  true,  array['equity','reserves','borrowings','payables','other_liab'],         -1)
) as v(statement, code, name, sort_order, is_subtotal, subtotal_of, sign);

-- ---------- Cash Flow display skeleton (values computed in code) ----------

insert into report_groups (entity_id, statement, code, name, sort_order, is_subtotal, subtotal_of, sign)
select e.id, v.statement::statement_kind, v.code, v.name, v.sort_order, v.is_subtotal, v.subtotal_of, v.sign
from entities e,
(values
  ('cf', 'pbt_cf',       'Profit Before Tax',                      10,  false, null::text[],                                  1),
  ('cf', 'non_cash',     'Adjustments for Non-Cash Items',         20,  false, null,                                          1),
  ('cf', 'op_before_wc', 'Operating Profit before WC Changes',     30,  true,  array['pbt_cf','non_cash'],                    1),
  ('cf', 'wc_changes',   'Changes in Working Capital',             40,  false, null,                                          1),
  ('cf', 'tax_paid',     'Income Tax Paid',                        50,  false, null,                                          1),
  ('cf', 'cfo',          'Net Cash from Operating Activities',     60,  true,  array['op_before_wc','wc_changes','tax_paid'], 1),
  ('cf', 'investing',    'Investing Activities',                   70,  false, null,                                          1),
  ('cf', 'cfi',          'Net Cash from Investing Activities',     80,  true,  array['investing'],                            1),
  ('cf', 'financing',    'Financing Activities',                   90,  false, null,                                          1),
  ('cf', 'cff',          'Net Cash from Financing Activities',    100,  true,  array['financing'],                            1),
  ('cf', 'net_change',   'Net Increase / (Decrease) in Cash',     110,  true,  array['cfo','cfi','cff'],                      1),
  ('cf', 'opening_cash', 'Cash at Beginning of Period',           120,  false, null,                                          1),
  ('cf', 'closing_cash', 'Cash at End of Period',                 130,  true,  array['net_change','opening_cash'],            1)
) as v(statement, code, name, sort_order, is_subtotal, subtotal_of, sign);

-- ---------- RBJV verticals ----------
-- The ten canonical verticals in effect from FY 2026-27.

insert into verticals (entity_id, code, name, sort_order)
select e.id, v.code, v.name, v.sort_order
from entities e,
(values
  ('CFC',     'Corporate Formation & Secretarial Compliances',  10),
  ('CMRGA',   'Capital Markets Readiness & Governance Assurance', 20),
  ('RRG',     'Remedial, Regulatory & Secretarial Compliances', 30),
  ('ECM',     'Enterprise Compliance Management',               40),
  ('DLR',     'Disputes, Litigation & Resolution',              50),
  ('GADD',    'Governance Assurance & Due Diligence',           60),
  ('AIF',     'AIF and Support',                                70),
  ('ACC',     'Akshayam Capability Center',                     80),
  ('PARTNER', 'Partner''s Contribution',                        90),
  ('COMMON',  'Common',                                        100)
) as v(code, name, sort_order)
where e.slug = 'rbjv';

-- Raw Zoho tag -> canonical vertical. Only exact, unambiguous matches are
-- seeded here. Anything else that turns up in an upload becomes its own
-- vertical flagged needs_review, so it is folded in deliberately rather than
-- guessed at.
insert into vertical_aliases (entity_id, raw_code, vertical_id)
select e.id, a.raw_code, v.id
from entities e
join verticals v on v.entity_id = e.id
join (values
  ('Corporate Formation & Secretarial Compliances (CFC)',      'CFC'),
  ('Capital Markets Readiness & Governance Assurance (CMRGA)',  'CMRGA'),
  ('Remedial, Regulatory & Secretarial Compliances (RRG)',      'RRG'),
  ('Enterprise Compliance Management (ECM)',                    'ECM'),
  ('Disputes, Litigation & Resolution (DLR)',                   'DLR'),
  ('Governance Assurance & Due Diligence (GADD)',               'GADD'),
  ('AIF and Support',                                           'AIF'),
  ('Akshayam Capability Center (ACC)',                          'ACC'),
  ('Partner''s contribution',                                   'PARTNER'),
  ('COMMON',                                                    'COMMON')
) as a(raw_code, code) on a.code = v.code
where e.slug = 'rbjv';
