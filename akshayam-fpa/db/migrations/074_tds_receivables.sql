-- ============================================================
-- MAK meeting - TDS receivables: the TDS the entity holds as receivable from
-- customers, year by year (FY23-24 to FY25-26), customer by customer, with the
-- vertical it belongs to - the "TDS" sheet of "TDS receivable - FY23-26.xlsx",
-- the position at 31-03-2026 (Part A: TDS booked in Zoho that the customer has
-- not shown in Form 26AS).
--
-- Year, vertical, customer and the TDS amount are the sheet's. The rest is kept
-- by the vertical's head against each row: the invoice it relates to (number,
-- date and value, as free text), an observation (seeded from the sheet's own)
-- and the follow-up action. The 10% of the invoice value is not stored: the
-- screen works it out from whatever invoice value is keyed.
--
-- A vertical's head sees only the rows of their own vertical: every read and
-- write goes through the verticals the signed-in entity covers.
-- ============================================================

create table tds_receivables (
  id          serial primary key,
  entity_id   integer not null references entities(id),
  vertical_id integer not null references verticals(id),
  -- the financial year the TDS belongs to, as the sheet names it: FY23-24
  fy          text    not null,
  customer    text    not null,
  -- the TDS receivable per the books, as the sheet has it
  tds_amount  numeric(14, 2) not null,
  inv_number  text,
  inv_date    text,
  inv_value   text,
  observation text,
  follow_up   text,
  -- the order the sheet lists them in, within a year
  sort_order  integer not null default 0,
  updated_by  integer references users(id),
  updated_at  timestamptz not null default now()
);

create index tds_receivables_vertical_idx on tds_receivables (vertical_id, fy);

insert into tds_receivables (entity_id, vertical_id, fy, customer, tds_amount, observation, sort_order)
select v.entity_id, v.id, d.fy, d.customer, d.amt, d.obs, d.ord
  from (values
  ('FY23-24', 'CHEMIPRIME IMPEX PRIVATE LIMITED', 9500.00, 'ECM', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 1),
  ('FY23-24', 'ELEMICAL SPECIALITIES PRIVATE LIMITED', 7500.00, 'AIF', 'No dealings in FY25-26 or FY26-27', 2),
  ('FY23-24', 'KRIYA DESIGN TECHNOLOGIES PRIVATE LIMITED', 5250.00, 'CFC', 'Probable group: Kriya Medical Technologies (TAN CHEM09264D) shows excess ₹36,250', 3),
  ('FY23-24', 'Madras Boat Club', 4950.00, 'AIF', 'No dealings in FY25-26 or FY26-27', 4),
  ('FY23-24', 'VALUEPLUS TECHNOLOGIES PRIVATE LIMITED', 4900.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 5),
  ('FY23-24', 'RADOLABS PRIVATE LIMITED', 4750.00, 'RRG', 'No dealings in FY25-26 or FY26-27', 6),
  ('FY23-24', 'Tiruchirappalli Engineering and Technology Cluster', 4750.00, 'CFC', 'No dealings in FY25-26 or FY26-27', 7),
  ('FY23-24', 'SURESHKUMAR KAVITHAA', 3200.00, 'DLR', 'Pair: same person as deductor "Kavitha Suresh Kumar" (TAN CHEK07155B) in excess ledger', 8),
  ('FY23-24', 'DCOMM VENTURES PRIVATE LIMITED', 3000.00, 'ECM', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 9),
  ('FY23-24', 'KAROMI TECHNOLOGY PRIVATE LIMITED', 3000.00, 'AIF', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 10),
  ('FY23-24', 'TAMIL NADU INDUSTRIAL HOUSING PRIVATE LIMITED', 3000.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 11),
  ('FY23-24', 'SHARVAGYAA FINANCE SERVICES PRIVATE LIMITED', 3250.00, 'ECM', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 12),
  ('FY23-24', 'Dashboard Account Aggregation Services Private Limited', 1920.00, 'AIF', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 13),
  ('FY23-24', '1PS SOFTWARE AND SUPPORT SOLUTIONS PRIVATE LIMITED', 2500.00, 'ECM', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 14),
  ('FY23-24', 'TAMIL NADU WILDERNESS EXPERIENCES CORPORATION PRIVATE LIMITED', 1500.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 15),
  ('FY23-24', 'IGP Engineers Private Limited', 1000.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 16),
  ('FY23-24', 'Maschio Gaspardo India Private Limited', 1000.00, 'CMRGA', 'No dealings in FY25-26 or FY26-27', 17),
  ('FY23-24', 'INSAP ENGINEERS PRIVATE LIMITED', 1000.00, 'CFC', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 18),
  ('FY24-25', 'DASHBOARD FINANCIAL HOLDINGS PRIVATE LIMITED', 77000.00, 'AIF', 'Large; no dealings since Apr-2025; group entity Dashboard Account Aggregation is active', 19),
  ('FY24-25', 'PM MEGA INTEGRATED TEXTILE REGIONS AND APPAREL PARK TAMIL NADU LIMITED', 29000.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 20),
  ('FY24-25', 'CYBELE INDUSTRIES LIMITED', 25425.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 21),
  ('FY24-25', 'A4 Hospitals', 25000.00, 'COMMON', 'No dealings in FY25-26 or FY26-27', 22),
  ('FY24-25', 'GRAND ANICUT LVF 1', 24000.00, 'COMMON', 'Group: 26AS FY24-25 shows Grand Anicut Trust 1 ₹32,000 & Anicut Capital LLP ₹15,000 (excess) – same fund group', 23),
  ('FY24-25', 'Tidel Neo Limited', 23000.00, 'GADD', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 24),
  ('FY24-25', 'Uniprime Plastics Private Limited', 17500.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 25),
  ('FY24-25', 'TAMIL NADU INDUSTRIAL HOUSING PRIVATE LIMITED', 9000.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 26),
  ('FY24-25', 'PKF Sridhar & Santhanam', 8475.00, 'ECM', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 27),
  ('FY24-25', 'Magnus Infrastructure Private Limited', 7500.00, 'CFC', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 28),
  ('FY24-25', 'RAMANUJAM and BOOVARAHAN', 7500.00, 'CMRGA', 'No dealings in FY25-26 or FY26-27', 29),
  ('FY24-25', 'QWAY TECHNOLOGIES PRIVATE LIMITED', 6000.00, 'ECM', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 30),
  ('FY24-25', 'ONS Equipment Private Limited.', 5000.00, 'DLR', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 31),
  ('FY24-25', 'ASHLEY ALTEAMS INDIA LIMITED', 4200.00, 'COMMON', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 32),
  ('FY24-25', 'Elite Paloume Forwarders Chennai Private Limited', 4000.00, 'CMRGA', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 33),
  ('FY24-25', 'LAND OPTIMIZER INTERNATIONAL PRIVATE LIMITED', 3750.00, 'CFC', 'Customer holds unadjusted credit ₹10,659.48 in books', 34),
  ('FY24-25', 'TAMIL NADU WILDERNESS EXPERIENCES CORPORATION PRIVATE LIMITED', 3300.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 35),
  ('FY24-25', 'CHENNAI SHORELINE RENOURISHMENT AND REVITALISATION PROJECTS LIMITED', 3000.00, 'CFC', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 36),
  ('FY24-25', 'ST.JOHN FREIGHT SYSTEMS LIMITED', 3000.00, 'RRG', 'No dealings in FY25-26 or FY26-27', 37),
  ('FY24-25', 'TAMIL NADU WORKING WOMEN''S HOSTELS CORPORATION LIMITED', 2775.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 38),
  ('FY24-25', 'FIRESTREAM WORLDWIDE INC', 2500.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 39),
  ('FY24-25', 'KRIPYA TECHNOLOGIES (INDIA) PRIVATE LIMITED', 2250.00, 'GADD', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 40),
  ('FY24-25', 'Dashboard Account Aggregation Services Private Limited', 2000.00, 'AIF', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 41),
  ('FY24-25', 'INDICVISION PRIVATE LIMITED', 2000.00, 'CMRGA', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 42),
  ('FY24-25', 'VALUEPLUS TECHNOLOGIES PRIVATE LIMITED', 2000.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 43),
  ('FY24-25', 'UTRACON STRUCTURAL SYSTEMS PRIVATE LIMITED', 1575.00, 'ECM', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 44),
  ('FY24-25', 'PJ RAJOO BUSINESS ASSOCIATES PRIVATE LIMITED', 1500.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 45),
  ('FY24-25', 'TURF TOWN TECHNOLOGIES PRIVATE LIMITED', 1184.00, 'CMRGA', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 46),
  ('FY24-25', 'INSAP ENGINEERS PRIVATE LIMITED', 1000.00, 'CFC', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 47),
  ('FY24-25', 'Mobismart Card Technology Private Limited', 1000.00, 'CFC', 'Customer holds unadjusted credit ₹1,000 in books', 48),
  ('FY24-25', 'WONDERSOFT PRIVATE LIMITED', 1000.00, 'DLR', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 49),
  ('FY24-25', 'CHEMIPRIME IMPEX PRIVATE LIMITED', 750.00, 'AIF', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 50),
  ('FY24-25', 'Tiruchirappalli Engineering and Technology Cluster', 250.00, 'CFC', 'No dealings in FY25-26 or FY26-27', 51),
  ('FY24-25', 'Khaitan & Co LLP - Karnataka', 0.02, 'RRG', 'Rounding difference', 52),
  ('FY24-25', 'TAMIL NADU RURAL HOUSING AND INFRASTRUCTURE DEVELOPMENT CORPORATION', 500.00, 'RRG', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 53),
  ('FY24-25', 'TANOSHII ADVISORY Private Limited', 1000.00, 'ECM', 'Customer still dealing with RBJV (FY25-26/26-27 transactions or 26AS credits)', 54),
  ('FY25-26', 'AK Law Chambers', 54000.00, 'DLR', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 55),
  ('FY25-26', 'Khaitan & Co LLP - Karnataka', 50000.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 56),
  ('FY25-26', 'TRIPLICANE PERMANENT FUND NIDHI LIMITED', 29214.60, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 57),
  ('FY25-26', 'Saksoft Limited', 28055.90, 'DLR', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 58),
  ('FY25-26', 'Indian Corporate Business Centre Limited', 28000.00, 'DLR', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 59),
  ('FY25-26', 'PM MEGA INTEGRATED TEXTILE REGIONS AND APPAREL PARK TAMIL NADU LIMITED', 18000.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 60),
  ('FY25-26', 'Trilo Infotech Pvt Ltd', 16500.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 61),
  ('FY25-26', 'CHENNAI SHORELINE RENOURISHMENT AND REVITALISATION PROJECTS LIMITED', 15037.50, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 62),
  ('FY25-26', 'Domanic Savio', 15000.00, 'DLR', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 63),
  ('FY25-26', 'LAND OPTIMIZER INTERNATIONAL PRIVATE LIMITED', 14600.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 64),
  ('FY25-26', 'THINKINNOV SOLUTION TECHNOLOGIES PRIVATE LIMITED', 11250.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 65),
  ('FY25-26', 'Tidel Neo Limited', 10500.00, 'GADD', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 66),
  ('FY25-26', 'RUGR FINTECH PRIVATE LIMITED', 10000.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 67),
  ('FY25-26', 'TANOSHII ADVISORY Private Limited', 6000.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 68),
  ('FY25-26', 'SHOLINGUR TEXTILES PRIVATE LIMITED', 5500.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 69),
  ('FY25-26', 'Uniprime Plastics Private Limited', 5001.60, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 70),
  ('FY25-26', 'OHM GLOBAL MOBILITY PRIVATE LIMITED', 5000.00, 'GADD', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 71),
  ('FY25-26', 'KAVERI GAS POWER LIMITED', 5000.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 72),
  ('FY25-26', 'Dangote Industries Limited', 5000.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 73),
  ('FY25-26', 'HESA ENTERPRISES PRIVATE LIMITED', 5000.00, 'AIF', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 74),
  ('FY25-26', 'Kesava Seeds Pvt Ltd', 4500.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 75),
  ('FY25-26', 'GREENPLEDGE PRODUCTS PRIVATE LIMITED', 4150.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 76),
  ('FY25-26', 'Mr. Nellai K Koman', 3750.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 77),
  ('FY25-26', 'PLENUS LOGISTICS PRIVATE LIMITED', 3500.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 78),
  ('FY25-26', 'Synergen Pharma India Private Limited', 3500.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 79),
  ('FY25-26', 'BULKARGO MARITIME PRIVATE LIMITED', 3500.00, 'DLR', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 80),
  ('FY25-26', 'NATIONAL SHIPBUILDING & HEAVY INDUSTRIES PARK TAMIL NADU LTD', 3375.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 81),
  ('FY25-26', 'Dr. S Anuradha', 3300.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 82),
  ('FY25-26', 'CYBELE INDUSTRIES LIMITED', 3250.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 83),
  ('FY25-26', 'SHARVAGYAA FINANCE SERVICES PRIVATE LIMITED', 3250.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 84),
  ('FY25-26', 'FIRESTREAM WORLDWIDE INC', 3000.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 85),
  ('FY25-26', 'TAMIL NADU RURAL HOUSING AND INFRASTRUCTURE DEVELOPMENT CORPORATION', 3000.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 86),
  ('FY25-26', 'KERALA INFRASTRUCTURE FUND MANAGEMENT LIMITED', 3000.00, 'AIF', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 87),
  ('FY25-26', 'E C PROGRAMMAA PRIVATE LIMITED', 3000.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 88),
  ('FY25-26', 'Varanam Gourmet Private Limited', 3000.00, 'GADD', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 89),
  ('FY25-26', 'KRITILABS TECHNOLOGIES LIMITED', 2999.60, 'GADD', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 90),
  ('FY25-26', 'E-SHIP GLOBAL LOGISTICS INDIA PRIVATE LIMITED', 2905.00, 'GADD', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 91),
  ('FY25-26', 'Mr. Ramkumar C', 2850.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 92),
  ('FY25-26', 'POLYFIT FABRICATORS P. Ltd.', 2750.00, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 93),
  ('FY25-26', 'MARS RAIL-FIT ENGINEERS PRIVATE LIMITED', 2750.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 94),
  ('FY25-26', 'AEQUITAS DEBT SOLUTIONS PRIVATE LIMITED', 2700.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 95),
  ('FY25-26', 'WONDERSOFT PRIVATE LIMITED', 2500.00, 'DLR', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 96),
  ('FY25-26', 'NSTORE RETECH PRIVATE LIMITED', 2500.00, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 97),
  ('FY25-26', 'Swach Environment Private Limited', 2500.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 98),
  ('FY25-26', 'VIDHYUT NIRMAN CORPORATION', 2500.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 99),
  ('FY25-26', 'INDICVISION PRIVATE LIMITED', 2400.00, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 100),
  ('FY25-26', 'TRACOGO PRIVATE LIMITED', 2250.00, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 101),
  ('FY25-26', 'BARRENWORT ENTERPRISES PVT LTD', 2250.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 102),
  ('FY25-26', 'MS FIRST CAPITAL INSURANCE LIMITED', 2250.00, 'COMMON', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 103),
  ('FY25-26', 'GLOBANT INDIA PRIVATE LIMITED', 2034.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 104),
  ('FY25-26', 'ZENOX GAS SYSTEMS PRIVATE LIMITED', 2000.00, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 105),
  ('FY25-26', 'SREE SUMANGALA COPPERTEC PRIVATE LIMITED', 2000.00, 'GADD', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 106),
  ('FY25-26', 'Kripya Solutions Private Limited', 1999.20, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 107),
  ('FY25-26', 'SYSTEMA AUTOMATION INDIA PRIVATE LIMITED', 1868.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 108),
  ('FY25-26', 'INTLOSOL WORKS PRIVATE LIMITED', 1850.00, 'GADD', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 109),
  ('FY25-26', 'Mr.Abdul Qadir', 1750.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 110),
  ('FY25-26', 'TAMIL NADU WILDERNESS EXPERIENCES CORPORATION PRIVATE LIMITED', 1741.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 111),
  ('FY25-26', 'Aurrera Beaumonde Pvt Ltd', 1655.00, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 112),
  ('FY25-26', 'TAMIL NADU INDUSTRIAL HOUSING PRIVATE LIMITED', 1500.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 113),
  ('FY25-26', 'DCOMM VENTURES PRIVATE LIMITED', 1500.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 114),
  ('FY25-26', 'M CT M GLOBAL INVESTMENTS PRIVATE LIMITED', 1500.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 115),
  ('FY25-26', 'Uncia Technologies Private Limited', 1500.00, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 116),
  ('FY25-26', 'IPRIME CONSULTANCY SERVICES PRIVATE LIMITED', 1500.00, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 117),
  ('FY25-26', 'OTS ASTRACON INDIA PRIVATE LIMITED', 1500.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 118),
  ('FY25-26', 'Audentius Corporate Advisors LLP', 1500.00, 'AIF', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 119),
  ('FY25-26', 'Forte Legal', 1500.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 120),
  ('FY25-26', 'REIO systems private limited', 1350.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 121),
  ('FY25-26', 'SMARTAUDIT SERVICES PRIVATE LIMITED', 1250.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 122),
  ('FY25-26', 'SMARTHAAS MANAGEMENT SERVICES PRIVATE LIMITED', 1250.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 123),
  ('FY25-26', 'Quantra Technology Solutions Private Limited', 1250.00, 'CMRGA', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 124),
  ('FY25-26', 'Andhra Pradesh Football Association', 1250.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 125),
  ('FY25-26', 'DASHBOARD FINANCIAL HOLDINGS PRIVATE LIMITED', 1000.00, 'AIF', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 126),
  ('FY25-26', 'ERIC RISK MANAGEMENT SOLUTIONS PRIVATE LIMITED', 1000.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 127),
  ('FY25-26', 'LSI-MECH ENGINEERS PRIVATE LIMITED', 1000.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 128),
  ('FY25-26', 'SAAFE TECHNOLOGY SOLUTIONS PRIVATE LIMITED', 1000.00, 'AIF', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 129),
  ('FY25-26', 'Manali–Ennore Restoration and Rejuvenation Council', 1000.00, 'CFC', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 130),
  ('FY25-26', '1PS SOFTWARE AND SUPPORT SOLUTIONS PRIVATE LIMITED', 999.58, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 131),
  ('FY25-26', 'ASHLEY ALTEAMS INDIA LIMITED', 750.00, 'COMMON', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 132),
  ('FY25-26', 'TAMIL NADU WORKING WOMEN''S HOSTELS CORPORATION LIMITED', 500.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 133),
  ('FY25-26', 'VALUEPLUS TECHNOLOGIES PRIVATE LIMITED', 41.00, 'RRG', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 134),
  ('FY25-26', 'QWAY TECHNOLOGIES PRIVATE LIMITED', 20.00, 'ECM', 'TDS booked in Zoho, not in Form 26AS (12-Oct-2026)', 135)
  ) as d(fy, customer, amt, vcode, obs, ord)
  join verticals v on v.code = d.vcode
   and v.entity_id = (select id from entities where slug = 'rbjv');

do $$
begin
  if (select count(*) from tds_receivables) <> 135 then
    raise exception 'tds_receivables: expected 135 rows, loaded %', (select count(*) from tds_receivables);
  end if;
end $$;
