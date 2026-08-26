# Group Management Reporting

An interactive, mobile-responsive replacement for the monthly Excel/Google Sheets
reporting pack: profit & loss, balance sheet and cash flow built straight from
Zoho Books exports, plus revenue, receivables and collections views.

Four views, switched from the header:

- **RBJV & Associates**
- **Akshayam Corporate Advisors Private Limited**
- **Group (consolidated)** — both companies together, intercompany eliminated
- **RAJA (GIFT + AIF)** — one partner's book: all of Akshayam plus RBJV's AIF vertical

## P&L structure

The statement follows the firm's own convention rather than a textbook layout:

| Line | What goes in it |
|---|---|
| Direct Costs | consultancy charges, VPP, professional fees, staff salary |
| Establishment Cost | office rent, electricity, building maintenance |
| Overheads | everything else |
| Reimbursable Costs Recovered (net) | MCA fees paid by card and recharged to clients, shown **net** on one line |
| Partners' Drawings | below PAT, deliberately outside EBITDA |

Depreciation is charged once a year at audit, so monthly EBIT runs ahead of the
final position until that entry lands.

## Getting it running

```bash
npm install       # already done
npm run db:setup  # one-time: creates the role, database and tables
npm run dev       # http://localhost:3000
```

`db:setup` asks for your PostgreSQL superuser password once, in a hidden
prompt. It is used for that session only and never written to disk. The script
then creates a dedicated `akshayam_app` role with a generated password, creates
the database owned by that role, writes `DATABASE_URL` into `.env.local`, and
applies the migrations. **The app never runs as a superuser.**

It must be run from a real terminal (PowerShell) so it can prompt. Re-running it
is safe — it rotates the app password and re-applies any pending migrations.

Afterwards, `npm run db:migrate` applies new migrations on their own.

## What to upload, and in what order

Everything is exported from Zoho Books as **XLSX**.

| Report | Zoho path | How often | Why |
|---|---|---|---|
| **General Ledger** | Reports → Accountant → General Ledger | Monthly | Produces the P&L, balance sheet and cash flow on its own. Export the full financial year. |
| **Trial Balance** | Reports → Accountant → Trial Balance | Once a year | Prior-year closing balances — the ledger cannot tell us what the balance sheet opened at. |
| Invoice Details | Reports → Sales → Invoice Details | Weekly | Revenue by client, vertical, salesperson. |
| Customer Payments | Reports → Sales → Customer Payments | Weekly | Collections and DSO. |
| AR Aging Details | Reports → Receivables → AR Aging Details | Weekly | Outstanding and ageing. |

**Re-uploads are safe.** A general ledger covering April–June replaces whatever
was previously stored for April–June. A re-opened month just gets re-uploaded.

**Verticals** come from Zoho reporting tags. If the general ledger export
carries a reporting-tag column, vertical-wise P&L works automatically. If it
does not, the app says so rather than showing a silently wrong split.

## The account mapping screen

Zoho knows an account is an "Expense". It does not know whether that expense
belongs in direct costs, employee costs or admin — and that judgement is what
makes the P&L read the way management expects.

On the first upload every account gets a suggested reporting line. Anything the
app could not classify confidently is flagged on **Settings → Account mapping**
and excluded from the statements until it is assigned. New accounts appearing in
later uploads are flagged the same way rather than being absorbed silently.

## Layout

```
db/migrations/     schema and seed, applied in filename order
src/lib/parse/     Excel parsers - tolerant of Zoho's title rows and layouts
src/lib/reports/   statement builders (P&L, balance sheet, cash flow) and drill-downs
src/lib/mapping.ts account auto-classification rules
src/app/           pages and API routes
scripts/           fixture generation and parser smoke tests
```

## Cash flow

Indirect method, built from the same ledger as the other two statements, for
either company or the group.

It ties by construction rather than by a balancing figure. Every journal
balances, so across a period the movements on all accounts sum to zero:

    m(cash) + m(everything else) = 0        where m(a) = debit − credit

The increase in cash is therefore minus the movement on every other account, so
each line is just `−m(a)` for the accounts in its bucket, and the buckets
partition the chart of accounts. The page checks the total against what the
bank accounts actually did — the two are derived independently, so a gap means
an account is missing rather than misfiled, and it says so on screen.

`accounts.cf_category` decides the bucket:

| Category | Line |
|---|---|
| `pnl` | Profit before tax |
| `non_cash_addback` | Adjustments for non-cash items |
| `wc_operating` | Changes in working capital |
| `tax` | Income tax paid |
| `investing` | Investing activities |
| `financing` | Financing activities — including partners' drawings |
| `cash` | the result, not a line |
| anything else | Unclassified movements, shown rather than absorbed |

Three placements are worth knowing:

- **Interest is inside profit before tax**, not financing. Both treatments are
  allowed, but a statement whose opening line is labelled "Profit Before Tax"
  and shows something other than the P&L's own figure is not worth reading.
- **Accumulated depreciation is a non-cash add-back**, not investing. Left in
  investing it nets the depreciation charge off against asset purchases, so
  that section stops showing what was actually bought.
- **TDS and GST control accounts stay in working capital.** They are settled
  with customers and the authorities as part of ordinary trade. Only income tax
  proper — advance tax, provisions, deferred tax — reaches the tax line.

On the group, intercompany *balances* are eliminated but intercompany
*movements* are not, because the cash that went with them is still in the
group's banks. Money genuinely moving between the two companies nets to nothing
and vanishes from that line by itself; what remains is the amount the two
ledgers disagree by, shown as **Intercompany, not eliminated**.

## Budget vs actual

Revenue and Collections each carry a budget-vs-actual table by vertical, laid
out the way the firm already reads it: annual budget, period budget, actual,
variance, % achievement. Budgets are annual, per vertical, and separate for the
two measures - the collection budget runs about 8% above the revenue budget.

**The period budget is the annual budget times the share of the year covered**,
and for year-to-date that share is *whole months*: a ledger pasted to 24 August
carries five months of budget, not four and three-quarters. That is the firm's
convention and it keeps the figure a round twelfth multiple.

**How far the year has run is taken from the general ledger**, never from the
invoice or receipt registers. Those can run ahead — RBJV's invoice register
holds invoices dated to 31 August while its ledger stops on the 24th — and a
period budget that changed depending on which page you opened would be
indefensible.

Year to date ends at the last *completed* reporting week rather than the last
day of data, so the figure does not drift mid-week and a Monday reading is never
compared against a Thursday budget. A ledger pasted to Monday 24 August reports
to Thursday 20 August.

### Weeks

The firm's week runs **Friday to Thursday**, and week 1 is the one ending on the
first Thursday of the financial year — for FY 2026-27, Fri 27 Mar to Thu 2 Apr
2026. Week 1 therefore starts a few days before the year does, deliberately:
the week is the unit the firm reports on, and splitting it at the year end
leaves a stub nobody recognises. FY 2026-27 has 53 such weeks, so a weekly
budget is a fifty-third.

### Pickers

Revenue and Collections take a **month** or **week** picker beside the year and
vertical ones. They are alternative cuts of the same year, so choosing one
clears the other. Everything on the page follows the choice except the
by-month trend chart, which stays on the full year — a twelve-month shape is
what makes it worth having.

**Picking a week or month shows both it and the year to date up to it, with the
cumulative leading.** The headline tile is the running figure and the single
week or month sits beneath it; the budget table puts "Up to week 21" first and
"Week 21 alone" second, set back a shade. A week on its own says what happened;
only the year to date says whether the year is on track, and one quiet week
reads like a crisis without the run-rate in front of it. Year to date is
already cumulative, so it shows one set of columns rather than the same figures
twice.

**The Period Budget is the whole months up to the month the chosen week falls
in.** Week 21 ends in August, so it carries five months of budget - the same
figure the year-to-date view uses, and the same one the firm's own report
shows. The single week is measured against a fifty-third of the year, which is
what makes its own variance mean anything.

Revenue actual comes from the **ledger**, not the invoice register. It is net of
credit notes by construction — a credit note debits the revenue account — and it
equals the P&L line exactly, so budget performance and the profit statement can
never tell two different stories. The ledger also attributes by the reporting
tag the entry was posted with, which is a stronger signal than the invoice's
salesperson: Common reads 11.8 L from the ledger against the register's 3.2 L,
and it is the ledger that agrees with the client's own report. It will differ
from the invoiced figure in the tiles where an invoice was raised in one period
and posted in another.

| Measure | Actual is |
|---|---|
| Revenue | the ledger's Revenue from Operations — net of credit notes by construction, and equal to the P&L line exactly |
| Revenue, split | professional fee and retainership fee, from the recurring-invoice list |
| Collection | fee receipts, excluding reimbursement recoveries, since a recharge of a client-paid cost is not collection performance |

A vertical can show a **negative actual** for a period when a credit note
outweighs what it billed. It is printed in brackets rather than unsigned, which
would read as a good month.

### What the Revenue page leads with

Six tiles in three pairs, read across - target then period target, result then
achievement, and the two halves of the fee. They are the budget position rather
than the invoice register:

| Tile | |
|---|---|
| Annual Budget | the year's target |
| Period Budget | annual × the months elapsed to the period end |
| Actual | ledger revenue, net of credit notes, equal to the P&L |
| % Achievement | actual over period budget |
| Professional fee | the remainder after the retainer |
| Recurring retainership fee | from the retainer list |

Variance is not a tile: it is the achievement percentage said a second way, and
the budget table below carries it per vertical. Gross invoiced, the credit-note
deduction and reimbursements billed are workings, not headlines, so they sit in
a line under the tiles with links to their document lists. A partner reading the page first wants to know whether
the year is on budget, not what the register grossed before deductions.

**Picking a week does not shrink the period budget to a week.** Week 21 falls
in August, so the budget behind it is five months of the year — the same figure
the year-to-date view shows and the firm's own convention. The week's own
actual appears beneath the Actual tile, and the budget table below carries the
full week-alone column set.

### Professional and retainership fee

The firm bills two kinds of work: one-off professional engagements, and a
monthly retainer that recurs whether or not anything happened that month. A
vertical carrying 80% retainer is a very different business from one carrying
none, so revenue is split on the budget table.

Only the **retainer** half is stored, from the recurring-invoice list uploaded
as `--retainers`. Professional fee is the remainder of ledger revenue, never a
second measurement — which is what keeps the two adding to the P&L exactly, and
means a retainer figure that is slightly off shifts the split without ever
changing the revenue the page reports.

The list arrives in two shapes and both are read rather than asking anyone to
reformat a working file:

| Shape | Looks like | Used by |
|---|---|---|
| long | `month · customer_name · customer_id · amount · Vertical` | RBJV |
| matrix | customers down the side, `Apr-26 … Aug-26` across, totals at the edges | Akshayam |

A customer billed twice in one month is added, not overwritten — the Akshayam
list has several such months.

**The split appears only where the window is whole calendar months.** Retainers
are billed monthly, so a single week has no defensible share of one; inventing
a fifth of a month's retainer would put a figure on the page that no invoice
supports. The week-alone columns therefore carry budget, actual, variance and
percentage but no split. Collections never split at all: a retainer is an
invoice, not a receipt, and the cash for one arrives whenever the client pays.

## Budget vs Actual

Its own page, and shorter than the statement pages, because it answers the
partners' question rather than the accountant's:

    Revenue
      less Team cost, Establishment cost, Other expenses
    = EBITDA
      less Depreciation, Interest
    = Profit before tax
      less Tax
    = Profit after tax
      less Partners' drawings
    = Reserves and surplus

Establishment cost is what the budget calls **Office Expenses** — rent,
electricity and building maintenance. Reimbursements and other income join
Other expenses rather than taking lines of their own: both are small, both
reach EBITDA, and a line each would lengthen the statement without telling
anyone something they act on.

**Neither side stores its subtotals.** EBITDA, PBT, PAT and retained profit are
computed from the lines, for the budget exactly as for the actual, so a budget
total can never be struck differently from the actual beside it.

**A favourable variance means more revenue or less cost.** Cost lines hold a
positive magnitude, so a plain subtraction would colour half the rows the wrong
way.

The period picker offers the year to date, the full year, any quarter and any
month. Year to date runs to the month the ledger has reached, part month
included — the same whole-month convention the revenue and collections pages
use, so the three never disagree about how far the year has run.

### Common-size P&L

Every line as a percentage of that month's revenue, with a year-to-date column
and the budget's own percentage beside it. Rupees say what happened; common
size says whether the shape of the business changed. Months with no revenue are
left out — every percentage in them would be a division by zero dressed as a
dash.

### Cost apportionment, for VPP

The budget's *Common Cost Apportionment Statement* spreads shared cost four
ways. The page applies those same bases to the **actual** pool, so the share a
vertical carries follows the rule the partners agreed and only the amount moves
as the year runs:

| Basis | Heads of cost |
|---|---|
| Equal, 9 verticals | common salaries and VPP, travel and conveyance, donation |
| Equal, 8 (excl Gift) | accounting support |
| Revenue ratio | consultancy charges, referral fee |
| Head count (excl Gift) | office expenses, staff welfare |
| Head count, all 9 | communication, other expenses |

The pool is what the ledger tagged COMMON or left untagged; cost already tagged
to a vertical is its own and is never re-spread. **Contribution** — revenue less
direct and apportioned cost — is the line VPP is struck on.

**The table's totals reconcile to the Budget vs Actual page**: revenue, total
cost and contribution for a quarter equal that quarter's revenue, cost and
EBITDA. Three things had to be true for that:

- it covers everything above EBITDA, other income and reimbursement recoveries
  included, and not depreciation, which sits below it
- Common's revenue, the partner contribution and anything untagged appear as
  their own columns after the nine, so the total is the whole company. They
  receive no apportionment — Common's *cost* is the pool and has already been
  spread, so only its revenue shows
- only the nine set the ratios. Counting Common's revenue in the denominator
  would quietly shrink every vertical's share and leave part of the pool
  unspread

Gift & Regulatory is one receiving unit across both companies, as the budget
treats it: RBJV's AIF vertical and all of Akshayam, with the five heads where
the payroll is. Head count follows the entity being viewed, so RBJV on its own
counts its 31 and the group counts all 36.

**The section only appears where there is something to apportion** — two or
more verticals that traded, and a pool to divide between them. Sharing cost out
is RBJV's arrangement; Akshayam is a single vertical whose costs are all its
own, and the statement rendered there as a grid of zeros, which reads as a
broken report rather than an inapplicable one. Verticals outside the budgeted nine (partner contribution,
unallocated) are listed with their own cost and no apportionment rather than
being dropped.

### Loading the budget

```bash
node --env-file-if-exists=.env.local scripts/load-budget.mts "PL_Vertical_Budget_FY2627.xlsx"
```

The three budget sheets are hand-built management schedules, not exports, so
each row is matched by name to the reporting line it belongs on and anything
unrecognised is **reported rather than absorbed**. Each sheet also repeats its
overheads further down as a working; the load stops at that break. Read
straight through, every one of those costs lands twice — the first run put
establishment cost at three times its real figure.

## Drilling into a figure

Every headline figure on Revenue, Collections and Receivables opens the
documents behind it. Clicking a tile adds `?drill=…` to the URL, so the
financial year, vertical and company already chosen carry through — the
receipts you see are the receipts behind *that* number, not the year's.

| Page | Tiles | Shows |
|---|---|---|
| Collections | total / fee / reimbursement, and the unmatched notice | date, receipt number, customer, mode, invoices mapped, amount, unallocated |
| Receivables | total / not yet due / over 90 / over 180 | invoice, date, due date, customer, salesperson, age, invoice value, balance |
| Revenue | fee / net / reimbursements / credit notes, and the excluded notice | document number, date, customer, salesperson, status, amount, incl. tax |

Two things worth knowing about the collections drill:

- **Amounts are the allocated share, not the receipt total.** A remittance that
  settles a fee invoice and an RI invoice belongs partly in each tile, so it
  appears in both at its split value. Showing the full receipt in both would
  double whatever the reader is drilling into.
- **Unallocated is the receipt's own unapplied balance** — an advance, an
  overpayment, or money banked before the invoice was raised. Zoho does not
  split it between fee and reimbursement, so it is shown whole and labelled.

On the group each row carries the company it belongs to. The screen shows the
first 250 rows, ordered so the ones worth seeing come first.

**Download Excel** sits on the P&L, Balance Sheet, Cash Flow and Budget vs
Actual pages as well as on every drill-down, and everything goes through one
writer so a downloaded sheet looks and behaves the same whichever page produced
it.

A statement sheet carries **every month and every quarter side by side**. On
screen a quarter expands on click; a sheet cannot, and hiding a column is
easier than rebuilding one. Balance-sheet quarters take the closing month
rather than a sum, and the cash flow's opening and closing cash lines keep
their own aggregation — the same rules the on-screen tables follow.

Budget vs Actual downloads as a **four-sheet workbook**: the statement with a
budget and actual column per month, the common-size percentages, and one
apportionment sheet per quarter that has something to apportion.

A drill-down download gives the whole thing — no cap. Figures are
written as real numbers and dates as real dates, with a totals row, a frozen
header, an auto-filter and Indian digit grouping, so the file can be sorted and
pivoted without being cleaned up first. A header block records which company,
period and vertical it came from; a sheet of invoice lines with no context on it
is the sort of thing that ends up in a board pack against the wrong quarter.

The export and the screen run the *same query*, from `src/lib/reports/drilldowns.ts`.
They were briefly two, which is exactly how a download comes to disagree with
the screen it was downloaded from.

## Reporting entities that are not companies

An entity reports on a set of members, each optionally narrowed to one
vertical. `entity_members` holds the set:

| Entity | Members | Means |
|---|---|---|
| Group (consolidated) | (RBJV, —) (Akshayam, —) | both companies in full |
| RAJA (GIFT + AIF) | (RBJV, AIF) (Akshayam, GIFT) | one vertical of each |

Vertical ids are unique across companies, so a slice needs only one extra
predicate — `vertical_id = any(...)` on top of the usual entity filter. The
clause is always present and no-ops on null, so every query has one shape
whether or not the entity is a slice; a clause that appeared only sometimes
would mean two shapes of every query and one of them would eventually be
forgotten.

**RAJA is deliberately not part of the group.** The group already counts both
companies in full, so folding a slice of them into it would count the same
revenue twice. `entities.consolidates` is true for the group alone, and it —
not "has members" — is what triggers intercompany elimination: a slice is not
the whole of anything, so nothing nets against it.

The slice reports **P&L, Revenue, Collections and Receivables**, and its
vertical picker offers GIFT and AIF separately. It has no **balance sheet or
cash flow**: those are whole-company statements, and drawing one across part of
two companies would be a figure with nothing behind it. Both pages say so.

## Consolidation

The group is an entity like any other, with the two companies pointing at it as
their parent. Every report reads the set of entity ids it covers — one for a
company, both for the group — so the same page code serves either, and a third
company would need no code at all.

Two things a consolidation must do that an addition cannot:

- **Intercompany balances are eliminated.** RBJV carries "Inter Company -
  Akshayam" and Akshayam carries "Inter concern - RBJV"; left in, the group
  would report owing money to itself on both sides. The accounts are flagged
  `is_intercompany` and removed from the consolidated statements only — each
  company's own balance sheet still shows them.
- **What the two sides disagree by is shown, not hidden.** The books do not
  agree on the intercompany balance, so the difference is carried as its own
  line, *Unreconciled intercompany difference*, rather than forced into
  reserves. It is a reconciliation someone has to do, and the statement says so.

**Verticals are not consolidated.** RBJV reports across ten practice areas;
Akshayam is a single vertical, GIFT and Support. No vertical means the same
thing in both, so the group P&L says this on screen rather than offering a
picker that would quietly show one company's figures under a group heading.

**Receivables use each company's own latest snapshot**, because the two AR
exports are rarely pulled on the same day. Where the dates differ the page says
which is which.

Uploading, account mapping and vertical housekeeping act on one set of books, so
they are unavailable on the group and say where to go instead.

## Loading a company from the command line

The upload page takes one file at a time, which is right for a weekly refresh.
Loading a company from scratch is five files in a set order, and wants to be
repeatable:

```bash
node --env-file-if-exists=.env.local scripts/ingest.mts akshayam   --gl "General Ledger.xlsx"   --tb "Trial Balance.xlsx" --as-of 2026-03-31   --invoices "Invoice Details.xlsx"   --payments "Payments Received.xlsx"   --ar "AR Aging Details.xlsx"
```

Ingest never re-guesses an account it has already seen — a suggestion that keeps
moving under the client's feet is worse than a stale one. When the mapping rules
themselves improve, this catches the old accounts up, leaving anything a human
confirmed alone:

```bash
node --env-file-if-exists=.env.local scripts/remap.mts akshayam --apply
```

## Checking the parsers

```bash
npm run fixtures       # writes Zoho-shaped sample files to storage/fixtures
npm run test:parsers   # runs every parser against them
```

The fixtures are deliberately awkward — title rows above the header, a sectioned
ledger, `dd/MM/yyyy` dates, bracketed negatives, total rows. They are also a
convenient way to see the dashboard populated before the real exports arrive:
upload `storage/fixtures/gl-sectioned.xlsx` as the general ledger and
`trial-balance.xlsx` as the opening trial balance.

## Conventions worth knowing

- **Signs.** P&L values are stored as `credit − debit` (income positive); balance
  sheet as `debit − credit` (assets positive). Display flips cost and liability
  lines, so every subtotal is a plain sum.
- **Currency.** Zoho's amount columns are already in INR base currency, even on
  USD invoices. USD value is `amount ÷ exchange_rate`. Multiplying is the classic
  error and inflates USD invoices by roughly 80×.
- **Unused credits** repeat on every invoice row of a customer in Zoho's AR
  export, so they are counted once per customer.
- **A trial balance has no account_type column**, so its Assets / Liabilities /
  Equities section headings are read instead. Without them a debit balance can
  be guessed onto the liabilities side from its name alone, which misstates both
  halves of the opening balance sheet.
- **A closing trial balance carries income and expense accounts too.** They are
  prior-year results and land in opening reserves; ignored, the opening balance
  sheet is short by exactly their total.
- **Balance-sheet columns show the closing position**, never the sum of their
  months. Three month-end positions do not add up to a quarter.
- **Zoho's `entity_number` is the document number** — the invoice, receipt or
  journal a ledger row came from. It is the only column tying a posting back to
  the invoice register, so without it receivables cannot be reconciled to the
  control account at all.
- **Void credit notes credit nothing**, and are excluded from revenue exactly as
  void invoices are.
- **Balances with no reporting line are shown, not hidden.** They appear under
  *Unclassified* on the balance sheet, under their own account names, inside the
  totals. The statement ties and the reader can see what has not been placed;
  the mapping screen still asks for a decision.
- **A company with one confirmed vertical has nothing to allocate.** Every row
  belongs to it, tagged or not. Akshayam tags its ledger five ways but runs a
  single business line — GIFT and Support — and its sales exports carry no tag
  column at all.

## Verticals

Zoho reporting tags are free text and were renamed with FY 2026-27. The ten
current verticals are seeded; any other tag that appears in an upload becomes a
flagged entry on **Settings → Verticals**, where it can be folded into a real
vertical. Merging repoints the history and records an alias, so the same tag is
never sorted twice.

## Reporting conventions worth knowing

- **Reimbursement (RI-) invoices** recover MCA fees paid on the firm's card. They
  are reported separately from fee income everywhere — revenue, collections and
  the P&L (where both sides net to one line).
- **Credit notes** reduce ledger revenue but never appear in Invoice Details, so
  the Revenue page nets them off explicitly. Without that file revenue reads
  roughly 19 lakh high against the P&L.
- **Void, rejected and draft invoices** are excluded from every revenue figure.
- **A receipt settling several invoices** arrives as one row with a comma-separated
  invoice list and a single total; Zoho gives no per-invoice applied amount. Each
  receipt is split into `payment_allocations` — pro-rata by invoice value where
  every referenced invoice is known, equally otherwise — so the reimbursement
  split and the vertical attribution are right even on mixed receipts.
- **Receivables ageing** runs from the due date. RBJV bills due on receipt — every
  invoice has due date = invoice date — so "overdue" means unpaid since raised,
  not past an agreed credit period. The page says so on screen.

## Not yet built

Authentication is not implemented — add it before hosting this anywhere the
financials would be reachable.
