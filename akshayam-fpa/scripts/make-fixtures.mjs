/**
 * Builds Zoho-shaped test workbooks so the parsers can be exercised before
 * the client's real exports arrive. Deliberately awkward: title rows above the
 * header, a sectioned ledger, dd/MM/yyyy dates, bracketed negatives, blank
 * spacer rows and a total line at the bottom.
 */
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? ".";
mkdirSync(outDir, { recursive: true });

/* ---------- 1. Sectioned general ledger ---------- */
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("General Ledger");

  ws.addRow(["Akshayam Corporate Advisors"]);
  ws.addRow(["General Ledger"]);
  ws.addRow(["From 01/04/2025 To 30/06/2025"]);
  ws.addRow([]);
  ws.addRow([
    "Date", "Account", "Transaction Details", "Transaction Type",
    "Transaction#", "Reporting Tag", "Debit", "Credit",
  ]);

  const section = (account) => ws.addRow([null, account]);
  const txn = (date, details, type, num, tag, debit, credit) =>
    ws.addRow([date, null, details, type, num, tag, debit, credit]);

  section("Professional Fees");
  txn("05/04/2025", "Acme Pvt Ltd - retainer", "Invoice", "INV-1001", "GIFT", null, "4,50,000");
  txn("18/05/2025", "Borealis LLP - ROC filing", "Invoice", "INV-1002", "AIF", null, "2,25,000");
  txn("09/06/2025", "Cygnus Industries", "Invoice", "INV-1003", "GIFT", null, "6,10,000");
  ws.addRow([null, "Total for Professional Fees", null, null, null, null, null, "12,85,000"]);
  ws.addRow([]);

  section("Salaries & Wages");
  txn("30/04/2025", "April payroll", "Journal", "JV-041", "GIFT", "3,20,000", null);
  txn("31/05/2025", "May payroll", "Journal", "JV-052", "GIFT", "3,20,000", null);
  txn("30/06/2025", "June payroll", "Journal", "JV-063", "AIF", "3,45,000", null);
  ws.addRow([]);

  section("Rent");
  txn("05/04/2025", "Office rent April", "Bill", "BILL-77", "GIFT", "85,000", null);
  txn("05/05/2025", "Office rent May", "Bill", "BILL-84", "GIFT", "85,000", null);
  txn("05/06/2025", "Office rent June", "Bill", "BILL-91", "GIFT", "85,000", null);
  ws.addRow([]);

  section("Depreciation");
  txn("30/06/2025", "Q1 depreciation", "Journal", "JV-070", null, "42,000", null);
  ws.addRow([]);

  section("Bank Charges");
  txn("30/04/2025", "Bank charges", "Journal", "JV-045", null, "1,200", null);
  ws.addRow([]);

  // Credit note handled as a negative debit, to exercise sign normalisation.
  section("Filing Fees");
  txn("12/06/2025", "MCA filing fees", "Expense", "EXP-12", "AIF", "(3,500)", null);
  ws.addRow([]);

  section("HDFC Bank");
  txn("20/04/2025", "Receipt from Acme", "Payment", "PAY-01", null, "4,50,000", null);
  txn("30/04/2025", "Payroll transfer", "Payment", "PAY-02", null, null, "3,20,000");
  txn("05/04/2025", "Rent paid", "Payment", "PAY-03", null, null, "85,000");
  ws.addRow([]);

  section("Trade Receivables");
  txn("05/04/2025", "Acme Pvt Ltd", "Invoice", "INV-1001", null, "4,50,000", null);
  txn("18/05/2025", "Borealis LLP", "Invoice", "INV-1002", null, "2,25,000", null);
  txn("09/06/2025", "Cygnus Industries", "Invoice", "INV-1003", null, "6,10,000", null);
  txn("20/04/2025", "Acme receipt", "Payment", "PAY-01", null, null, "4,50,000");
  ws.addRow([]);

  // Counter-entries, so the fixture is genuine double entry and the parser's
  // balance check has something real to verify.
  section("Accumulated Depreciation");
  txn("30/06/2025", "Q1 depreciation", "Journal", "JV-070", null, null, "42,000");
  ws.addRow([]);

  section("Salaries Payable");
  txn("31/05/2025", "May payroll accrued", "Journal", "JV-052", null, null, "3,20,000");
  txn("30/06/2025", "June payroll accrued", "Journal", "JV-063", null, null, "3,45,000");
  ws.addRow([]);

  section("Trade Payables");
  txn("05/05/2025", "Office rent May", "Bill", "BILL-84", null, null, "85,000");
  txn("05/06/2025", "Office rent June", "Bill", "BILL-91", null, null, "85,000");
  txn("12/06/2025", "MCA filing fees reversal", "Expense", "EXP-12", null, "3,500", null);
  txn("30/04/2025", "Bank charges", "Journal", "JV-045", null, null, "1,200");
  ws.addRow([]);

  ws.addRow(["Grand Total", null, null, null, null, null, "30,21,700", "30,21,700"]);

  await wb.xlsx.writeFile(join(outDir, "gl-sectioned.xlsx"));
  console.log("wrote gl-sectioned.xlsx");
}

/* ---------- 2. Flat general ledger, no reporting tag ---------- */
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["General Ledger"]);
  ws.addRow([]);
  ws.addRow(["Date", "Account Name", "Account Type", "Description", "Debit", "Credit"]);
  ws.addRow([new Date(Date.UTC(2025, 3, 5)), "Consulting Income", "Income", "Retainer", 0, 250000]);
  ws.addRow([new Date(Date.UTC(2025, 4, 5)), "Consulting Income", "Income", "Retainer", 0, 250000]);
  ws.addRow([new Date(Date.UTC(2025, 3, 30)), "Staff Welfare", "Expense", "Team lunch", 12000, 0]);
  ws.addRow([new Date(Date.UTC(2025, 3, 5)), "ICICI Bank", "Bank", "Receipt", 250000, 0]);
  ws.addRow([new Date(Date.UTC(2025, 4, 5)), "ICICI Bank", "Bank", "Receipt", 237000, 0]);
  ws.addRow([new Date(Date.UTC(2025, 3, 30)), "ICICI Bank", "Bank", "Welfare paid", 0, 12000]);
  await wb.xlsx.writeFile(join(outDir, "gl-flat.xlsx"));
  console.log("wrote gl-flat.xlsx");
}

/* ---------- 3. Trial balance ---------- */
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Trial Balance");
  ws.addRow(["Akshayam Corporate Advisors"]);
  ws.addRow(["Trial Balance as at 31/03/2025"]);
  ws.addRow([]);
  ws.addRow(["Account", "Account Type", "Debit", "Credit"]);
  ws.addRow(["HDFC Bank", "Bank", "12,40,000", null]);
  ws.addRow(["Trade Receivables", "Accounts Receivable", "8,75,000", null]);
  ws.addRow(["Office Equipment", "Fixed Asset", "3,20,000", null]);
  ws.addRow(["Share Capital", "Equity", null, "5,00,000"]);
  ws.addRow(["Reserves & Surplus", "Equity", null, "15,60,000"]);
  ws.addRow(["Trade Payables", "Accounts Payable", null, "2,90,000"]);
  ws.addRow(["Statutory Dues Payable", "Other Current Liability", null, "85,000"]);
  ws.addRow(["Total", null, "24,35,000", "24,35,000"]);
  await wb.xlsx.writeFile(join(outDir, "trial-balance.xlsx"));
  console.log("wrote trial-balance.xlsx");
}

/* ---------- 4. Invoice details, mixed currency ---------- */
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Invoice Details");
  ws.addRow(["Invoice Details"]);
  ws.addRow([]);
  ws.addRow([
    "Invoice Date", "Invoice Number", "Customer Name", "Item Name", "Reporting Tag",
    "Salesperson Name", "Currency Code", "Exchange Rate", "Amount Without Tax", "Total", "Status", "Due Date",
  ]);
  ws.addRow(["05/04/2025", "INV-1001", "Acme Pvt Ltd", "Retainer", "GIFT", "Raja", "INR", 1, 450000, 531000, "Paid", "05/05/2025"]);
  ws.addRow(["18/05/2025", "INV-1002", "Borealis LLP", "ROC filing", "AIF", "Rekha", "USD", 83.5, 225000, 225000, "Sent", "17/06/2025"]);
  ws.addRow(["09/06/2025", "INV-1003", "Cygnus Industries", "Advisory", "GIFT", "Raja", "INR", 1, 610000, 719800, "Sent", "09/07/2025"]);
  await wb.xlsx.writeFile(join(outDir, "invoice-details.xlsx"));
  console.log("wrote invoice-details.xlsx");
}

/* ---------- 5. AR aging details ---------- */
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("AR Aging Details");
  ws.addRow(["AR Aging Details"]);
  ws.addRow([]);
  ws.addRow([
    "Customer Name", "Invoice Number", "Invoice Date", "Due Date", "Reporting Tag",
    "Currency Code", "Exchange Rate", "Amount", "Balance", "Unused Credits",
  ]);
  ws.addRow(["Borealis LLP", "INV-1002", "18/05/2025", "17/06/2025", "AIF", "USD", 83.5, 225000, 225000, 15000]);
  ws.addRow(["Borealis LLP", "INV-0987", "02/01/2025", "01/02/2025", "AIF", "USD", 83.5, 180000, 180000, 15000]);
  ws.addRow(["Cygnus Industries", "INV-1003", "09/06/2025", "09/07/2025", "GIFT", "INR", 1, 610000, 610000, 0]);
  await wb.xlsx.writeFile(join(outDir, "ar-aging.xlsx"));
  console.log("wrote ar-aging.xlsx");
}

/* ---------- 6. Customer payments ---------- */
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Customer Payments");
  ws.addRow(["Customer Payments"]);
  ws.addRow([]);
  ws.addRow(["Date", "Payment Number", "Customer Name", "Invoice Number", "Currency Code", "Amount", "BCY Amount", "Payment Mode"]);
  ws.addRow(["20/04/2025", "PAY-01", "Acme Pvt Ltd", "INV-1001", "INR", 531000, 531000, "Bank Transfer"]);
  ws.addRow(["15/06/2025", "PAY-02", "Cygnus Industries", "INV-1003", "INR", 200000, 200000, "Bank Transfer"]);
  await wb.xlsx.writeFile(join(outDir, "customer-payments.xlsx"));
  console.log("wrote customer-payments.xlsx");
}
