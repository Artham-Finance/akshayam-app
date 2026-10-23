-- ============================================================
-- Capital Markets Readiness & Governance Assurance (CMRGA) is no longer continuing,
-- and its open receivables are shifted to other verticals, invoice by invoice.
--
-- This holds the list as at 22-10-2026 ("Every open invoice" for CMRGA, with the
-- vertical each invoice was shifted to - the Team column).
--
-- What it does:
--   * the MAK meeting's "CMRGA receivables" tab lists these invoices, each vertical
--     seeing only the ones shifted to it;
--   * a receipt on one of these invoices after the list date counts in the collection of
--     the vertical it was shifted to, not CMRGA - see rebuildPaymentAllocations in
--     src/lib/ingest.ts, which applies the same rule every time allocations are rebuilt.
--
-- Receipts up to the list date stay with CMRGA, as they were collected before the shift.
-- ============================================================

create table receivable_transfers (
  id              serial primary key,
  entity_id       integer not null references entities(id),
  invoice_number  text    not null,
  invoice_date    date,
  due_date        date,
  customer_name   text    not null,
  -- the age in days, as the list gave it
  age_days        integer,
  from_vertical_id integer not null references verticals(id),
  to_vertical_id   integer not null references verticals(id),
  invoice_value   numeric(14, 2) not null,
  -- what was open on the invoice at as_of
  balance         numeric(14, 2) not null,
  -- the receivables are shifted as at this date; receipts after it follow the invoice
  as_of           date    not null,
  unique (entity_id, invoice_number)
);

create index receivable_transfers_to_idx on receivable_transfers (to_vertical_id);

insert into receivable_transfers
  (entity_id, invoice_number, invoice_date, due_date, customer_name, age_days,
   from_vertical_id, to_vertical_id, invoice_value, balance, as_of)
select e.id, d.inv, d.inv_date::date, d.due::date, d.customer, d.age,
       src.id, dst.id, d.value, d.balance, date '2026-10-22'
  from (values
  ('2627-0797', '2026-08-20', '2026-08-20', 'SECUREKLOUD TECHNOLOGIES LIMITED', 56, 'GADD', 71998.00, 71998.00),
  ('2627-0610', '2026-07-20', '2026-07-20', 'SECUREKLOUD TECHNOLOGIES LIMITED', 87, 'GADD', 71998.00, 71998.00),
  ('2627-0705', '2026-08-06', '2026-08-06', 'BlueBinaries Engineering and Solutions Private Limited', 70, 'GADD', 40500.00, 40500.00),
  ('2627-1021', '2026-10-03', '2026-10-03', 'KRETHA SPHERE ADVISORS LLP', 12, 'COMMON', 32400.00, 32400.00),
  ('2627-0738', '2026-08-13', '2026-08-13', 'Big Bang Boom Solutions Private Limited', 63, 'RRG', 32400.00, 32400.00),
  ('2627-0781', '2026-08-20', '2026-08-20', 'Big Bang Boom Solutions Private Limited', 56, 'RRG', 32400.00, 32400.00),
  ('2627-0679', '2026-07-31', '2026-07-31', 'Methodhub Software Limited', 76, 'DLR', 27000.00, 27000.00),
  ('2627-0846', '2026-09-01', '2026-09-01', 'TVS Srichakra Limited', 44, 'COMMON', 27000.00, 27000.00),
  ('2627-0130', '2026-04-24', '2026-04-24', 'PRESCIENCE DECISION SOLUTIONS PRIVATE LIMITED', 174, 'GADD', 27000.00, 27000.00),
  ('2627-0598', '2026-07-20', '2026-07-20', 'Kivotos AI Technology Private Limited', 87, 'ECM', 16200.00, 16200.00),
  ('2526-1845', '2026-02-20', '2026-02-20', 'Trilo Infotech Pvt Ltd', 237, 'GADD', 16200.00, 16200.00),
  ('2526-2034', '2026-03-20', '2026-03-20', 'Trilo Infotech Pvt Ltd', 209, 'GADD', 16200.00, 16200.00),
  ('2627-0427', '2026-06-20', '2026-06-20', 'Kivotos AI Technology Private Limited', 117, 'ECM', 16200.00, 16200.00),
  ('2627-0785', '2026-08-20', '2026-08-20', 'Kivotos AI Technology Private Limited', 56, 'ECM', 16200.00, 16200.00),
  ('2627-0828', '2026-08-24', '2026-08-24', 'Tidel Neo Limited', 52, 'ECM', 14750.00, 14750.00),
  ('2627-0825', '2026-08-24', '2026-08-24', 'TIDEL PARK MADURAI LIMITED', 52, 'ECM', 14750.00, 14750.00),
  ('2627-0824', '2026-08-24', '2026-08-24', 'Tidel Park Trichy Limited', 52, 'ECM', 14750.00, 14750.00),
  ('2627-0823', '2026-08-24', '2026-08-24', 'TIDEL PARK LIMITED', 52, 'ECM', 14750.00, 14750.00),
  ('2627-0967', '2026-09-21', '2026-09-21', 'Tidel Park Trichy Limited', 24, 'ECM', 14750.00, 14750.00),
  ('2627-0964', '2026-09-21', '2026-09-21', 'Tidel Neo Limited', 24, 'ECM', 14750.00, 14750.00),
  ('2627-0965', '2026-09-21', '2026-09-21', 'TIDEL PARK LIMITED', 24, 'ECM', 14750.00, 14750.00),
  ('2627-0966', '2026-09-21', '2026-09-21', 'TIDEL PARK MADURAI LIMITED', 24, 'ECM', 14750.00, 14750.00),
  ('2627-0269', '2026-05-20', '2026-05-20', 'PRESCIENCE DECISION SOLUTIONS PRIVATE LIMITED', 148, 'ECM', 10800.00, 10800.00),
  ('2627-0877', '2026-09-16', '2026-09-16', 'Tidel Park Trichy Limited', 29, 'ECM', 5900.00, 5900.00),
  ('2627-0739', '2026-08-17', '2026-08-17', 'Tidel Park Trichy Limited', 59, 'ECM', 5900.00, 5900.00),
  ('2627-0557', '2026-07-17', '2026-07-17', 'ANICUT CAPITAL LLP', 90, 'GADD', 5400.00, 5400.00),
  ('2627-0241', '2026-05-20', '2026-05-20', 'Kivotos AI Technology Private Limited', 148, 'ECM', 16200.00, 5400.00),
  ('2526-1685', '2026-01-20', '2026-01-20', 'Trilo Infotech Pvt Ltd', 268, 'GADD', 17700.00, 4200.00),
  ('2627-0020', '2026-04-09', '2026-04-09', 'Neuberg diagnostics private limited', 189, 'COMMON', 16200.00, 3000.00),
  ('2324-670', '2023-09-25', '2023-09-25', 'UTRACON STRUCTURAL SYSTEMS PRIVATE LIMITED', 1116, 'ECM', 2360.00, 2360.00),
  ('RI-2627-0127', '2026-05-19', '2026-05-19', 'FPS Innovation Labs Private Limited', 149, 'GADD', 2084.00, 1942.00),
  ('RI-2627-0390', '2026-07-22', '2026-07-22', 'ZENOX GAS SYSTEMS PRIVATE LIMITED', 85, 'GADD', 1100.00, 1100.00),
  ('2526-0051', '2025-04-20', '2025-04-20', 'Kripya Solutions Private Limited', 543, 'RRG', 26797.80, 1029.80),
  ('RI-2526-0644', '2025-10-08', '2025-10-08', 'Arvauto Ecom Private Limited', 372, 'GADD', 862.11, 787.00),
  ('RI-2627-0582', '2026-09-10', '2026-09-10', 'Tidel Park Trichy Limited', 35, 'ECM', 606.07, 606.07),
  ('RI-2627-0414', '2026-07-28', '2026-07-28', 'Uncia Technologies Private Limited', 79, 'RRG', 606.00, 606.00),
  ('RI-2627-0365', '2026-07-15', '2026-07-15', 'MOVATE TECHNOLOGIES PRIVATE LIMITED', 92, 'GADD', 606.00, 606.00),
  ('RI-2627-0463', '2026-08-06', '2026-08-06', 'TIDEL PARK MADURAI LIMITED', 70, 'ECM', 606.00, 606.00),
  ('RI-2627-0464', '2026-08-06', '2026-08-06', 'Tidel Park Trichy Limited', 70, 'ECM', 606.00, 606.00),
  ('RI-2627-0415', '2026-07-28', '2026-07-28', 'SECUREKLOUD TECHNOLOGIES LIMITED', 79, 'GADD', 606.00, 606.00),
  ('RI-2627-0643', '2026-09-28', '2026-09-28', 'TIDEL PARK MADURAI LIMITED', 17, 'ECM', 606.00, 606.00),
  ('RI-2627-0416', '2026-07-28', '2026-07-28', 'TURF TOWN TECHNOLOGIES PRIVATE LIMITED', 79, 'ECM', 606.00, 606.00),
  ('RI-2627-0270', '2026-06-25', '2026-06-25', 'CAUVERY KKK INDIA PRIVATE LIMITED', 112, 'RRG', 606.00, 606.00),
  ('RI-2627-0626', '2026-09-23', '2026-09-23', 'Tidel Neo Limited', 22, 'ECM', 606.00, 606.00),
  ('RI-2627-0609', '2026-09-21', '2026-09-21', 'Tidel Neo Limited', 24, 'ECM', 606.00, 606.00),
  ('RI-2627-0096', '2026-05-06', '2026-05-06', 'Zenith Lex and Co.', 162, 'COMMON', 606.00, 606.00),
  ('RI-2627-0581', '2026-09-10', '2026-09-10', 'TIDEL PARK MADURAI LIMITED', 35, 'ECM', 606.00, 606.00),
  ('RI-2627-0372', '2026-07-17', '2026-07-17', 'ANICUT CAPITAL LLP', 90, 'GADD', 606.00, 606.00),
  ('RI-2627-0008', '2026-04-02', '2026-04-02', 'SINDOORI MANAGEMENT SOLUTIONS PRIVATE LIMITED', 196, 'COMMON', 606.00, 606.00),
  ('RI-2627-0601', '2026-09-18', '2026-09-18', 'Tidel Neo Limited', 27, 'ECM', 606.00, 606.00),
  ('RI-2627-0001', '2026-04-02', '2026-04-02', 'SINDOORI MANAGEMENT SOLUTIONS PRIVATE LIMITED', 196, 'COMMON', 606.00, 606.00),
  ('RI-2627-0294', '2026-07-01', '2026-07-01', 'Varanam Gourmet Private Limited', 106, 'GADD', 404.00, 404.00),
  ('RI-2627-0444', '2026-07-31', '2026-07-31', 'ZENOX GAS SYSTEMS PRIVATE LIMITED', 76, 'GADD', 404.00, 404.00),
  ('RI-2627-0352', '2026-07-13', '2026-07-13', 'BEARLY TECHNOVATIONS PRIVATE LIMITED', 94, 'ECM', 404.00, 404.00),
  ('RI-2627-0303', '2026-07-02', '2026-07-02', 'PRESCIENCE DECISION SOLUTIONS PRIVATE LIMITED', 105, 'GADD', 404.00, 404.00),
  ('RI-2627-0061', '2026-04-22', '2026-04-22', 'PRESCIENCE DECISION SOLUTIONS PRIVATE LIMITED', 176, 'GADD', 404.00, 404.00),
  ('RI-2526-1294', '2026-03-30', '2026-03-30', 'Trilo Infotech Pvt Ltd', 199, 'GADD', 220.00, 220.00),
  ('RI-2324-493', '2023-10-31', '2023-10-31', 'Ultracon Structural Systems Private Limited', 1080, 'ECM', 412.00, 216.00),
  ('RI-2627-0323', '2026-06-10', '2026-06-10', 'Apollo World Connect Limited', 127, 'COMMON', 101.00, 101.00),
  ('2627-0756', '2026-08-20', '2026-08-20', 'KRITILABS TECHNOLOGIES LIMITED', 56, 'GADD', 32627.00, 60.00),
  ('RI-2627-0201', '2026-06-01', '2026-06-01', 'Tidel Park Trichy Limited', 136, 'ECM', 608.26, 0.26),
  ('RI-2627-0209', '2026-06-01', '2026-06-01', 'Kripya Solutions Private Limited', 136, 'RRG', 508.26, 0.26),
  ('RI-2627-0318', '2026-07-04', '2026-07-04', 'KRITILABS TECHNOLOGIES LIMITED', 103, 'GADD', 505.00, 0.20)
  ) as d(inv, inv_date, due, customer, age, team, value, balance)
  join entities e on e.slug = 'rbjv'
  join verticals src on src.entity_id = e.id and src.code = 'CMRGA'
  join verticals dst on dst.entity_id = e.id and dst.code = d.team;

do $$
begin
  if (select count(*) from receivable_transfers) <> 63 then
    raise exception 'receivable_transfers: expected 63 rows, loaded %', (select count(*) from receivable_transfers);
  end if;
end $$;

-- Receipts already on the books after the list date follow their invoice now; the ingest
-- applies the same rule whenever the allocations are rebuilt.
update payment_allocations a
   set vertical_id = t.to_vertical_id
  from receivable_transfers t, payments p
 where t.entity_id = a.entity_id
   and t.invoice_number = a.invoice_number
   and p.id = a.payment_id
   and p.payment_date > t.as_of;
