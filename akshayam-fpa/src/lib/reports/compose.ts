import type { FyMonth } from "@/lib/period";

/**
 * Statement composition: everything the statements do with rows once they have
 * been read, and nothing that reads them.
 *
 * Kept clear of the database and of the request context on purpose. The ways
 * these statements have gone wrong were arithmetic - a line hung off a heading
 * that did not exist, a subtotal that never saw a group - and this is the half
 * that can be exercised directly. scripts/check-statements.mts does exactly
 * that, without a database.
 */

export interface StatementLine {
  /** group code, or "acct:123" for a detail row */
  key: string;
  name: string;
  /** 0 = group heading/total, 1 = individual ledger account */
  level: number;
  isSubtotal: boolean;
  /** -1 means "show as positive but it subtracts", used by cost and liability lines */
  sign: number;
  groupCode: string | null;
  accountId: number | null;
  /** month key ("2025-04") -> signed rupee amount */
  values: Record<string, number>;
  /**
   * How this line combines the months of a quarter or year column, when it
   * differs from the rest of the statement. A cash flow is a flow statement
   * whose opening and closing cash lines are positions: three months of net
   * change add up, three opening balances do not.
   */
  columnAggregate?: "sum" | "first" | "last";
}

export interface StatementResult {
  months: FyMonth[];
  lines: StatementLine[];
  /** true when at least one account carries postings but no mapping */
  hasUnmapped: boolean;
  unmappedTotal: number;
  /** Consolidation only: what was removed as intercompany, and by how much the two sides disagreed. */
  eliminations?: {
    /** absolute value of the intercompany balances taken out, at the latest month */
    removed: number;
    /** what the two companies' books disagree by, at the latest month */
    difference: number;
  };
}

export interface GroupRow {
  code: string;
  name: string;
  sort_order: number;
  is_subtotal: boolean;
  subtotal_of: string[] | null;
  sign: number;
}

export function emptyValues(months: FyMonth[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of months) out[m.key] = 0;
  return out;
}

/** A balance carried into the year: prior-year trial balance plus earlier ledger. */
export interface BsOpeningRow {
  account_id: number;
  account_name: string;
  account_sort: number;
  group_code: string | null;
  amount: number;
}

/** One account's movement in one month of the year being reported. */
export interface BsMovementRow extends BsOpeningRow {
  month_key: string;
}

/**
 * Everything the balance sheet does with the rows once they have been read.
 *
 * Split out from the queries so the arithmetic can be exercised on its own.
 * Every way this statement has failed to tie was a composition bug - a profit
 * line hung off a heading that did not exist, a difference eliminated on one
 * side only - and none of them need a database to reproduce.
 * scripts/check-statements.mts holds the cases.
 */
export function composeBalanceSheet(input: {
  months: FyMonth[];
  groups: GroupRow[];
  opening: BsOpeningRow[];
  movements: BsMovementRow[];
  pnlMovements: { month_key: string; amount: number }[];
  interco: { account_id: number; month_key: string; amount: number }[];
  openingNonBs: { statement: string; amount: number }[];
  consolidating: boolean;
  detail: boolean;
}): StatementResult {
  const {
    months,
    groups,
    opening,
    movements,
    pnlMovements,
    interco,
    openingNonBs,
    consolidating,
    detail,
  } = input;

  const broughtForward = openingNonBs.reduce((sum, r) => sum + Number(r.amount), 0);

  // Build cumulative account balances per month end.
  const accounts = new Map<
    number,
    { name: string; sort: number; groupCode: string | null; values: Record<string, number> }
  >();

  const ensure = (id: number, name: string, sort: number, groupCode: string | null) => {
    let entry = accounts.get(id);
    if (!entry) {
      entry = { name, sort, groupCode, values: emptyValues(months) };
      accounts.set(id, entry);
    }
    return entry;
  };

  const openingByAccount = new Map<number, number>();
  for (const row of opening) {
    ensure(row.account_id, row.account_name, row.account_sort, row.group_code);
    openingByAccount.set(row.account_id, (openingByAccount.get(row.account_id) ?? 0) + row.amount);
  }

  const monthlyByAccount = new Map<number, Record<string, number>>();
  for (const row of movements) {
    const entry = ensure(row.account_id, row.account_name, row.account_sort, row.group_code);
    let byMonth = monthlyByAccount.get(row.account_id);
    if (!byMonth) {
      byMonth = {};
      monthlyByAccount.set(row.account_id, byMonth);
    }
    byMonth[row.month_key] = (byMonth[row.month_key] ?? 0) + row.amount;
    void entry;
  }

  for (const [id, entry] of accounts) {
    let running = openingByAccount.get(id) ?? 0;
    const byMonth = monthlyByAccount.get(id) ?? {};
    for (const m of months) {
      running += byMonth[m.key] ?? 0;
      entry.values[m.key] = running;
    }
  }

  // Retained profit for the year to date, expressed the balance-sheet way
  // (credit balance -> negative under debit-credit).
  const profitLine: Record<string, number> = emptyValues(months);
  let cumulativeProfit = 0;
  const profitByMonth = new Map(pnlMovements.map((r) => [r.month_key, r.amount]));
  for (const m of months) {
    cumulativeProfit += profitByMonth.get(m.key) ?? 0;
    profitLine[m.key] = -cumulativeProfit;
  }

  const rows = [...accounts.entries()].flatMap(([id, entry]) =>
    months.map((m) => ({
      month_key: m.key,
      group_code: entry.groupCode,
      account_id: id,
      account_name: entry.name,
      account_sort: entry.sort,
      amount: entry.values[m.key],
    })),
  );

  /**
   * The intercompany plug.
   *
   * Removing both sides of an intercompany balance leaves the group balance
   * sheet out by whatever the two companies disagree by - here RBJV shows less
   * owed to it than Akshayam shows owing. That difference is real and someone
   * has to reconcile it, so it is carried as its own line rather than smeared
   * across the statement or quietly forced into reserves.
   */
  const elimination: Record<string, number> = emptyValues(months);
  let removed = 0;
  let difference = 0;

  if (consolidating && interco.length > 0) {
    const balances = new Map<number, number>();
    const byAccountMonth = new Map<number, Record<string, number>>();

    for (const row of interco) {
      if (row.month_key < months[0].key) {
        // Anything before the year opens is part of the opening position.
        balances.set(row.account_id, (balances.get(row.account_id) ?? 0) + row.amount);
        continue;
      }
      let byMonth = byAccountMonth.get(row.account_id);
      if (!byMonth) {
        byMonth = {};
        byAccountMonth.set(row.account_id, byMonth);
      }
      byMonth[row.month_key] = (byMonth[row.month_key] ?? 0) + row.amount;
      if (!balances.has(row.account_id)) balances.set(row.account_id, 0);
    }

    const running = new Map(balances);
    for (const m of months) {
      let net = 0;
      for (const [id, opening] of balances) {
        const carried = (running.get(id) ?? opening) + (byAccountMonth.get(id)?.[m.key] ?? 0);
        running.set(id, carried);
        net += carried;
      }
      // Books balance, so kept accounts sum to -net once the intercompany ones
      // are taken out. Putting `net` back as its own line restores the equality
      // without disturbing any real balance.
      elimination[m.key] = net;
    }

    const closing = [...running.values()];
    removed = closing.reduce((sum, v) => sum + Math.abs(v), 0);
    difference = Math.abs(closing.reduce((sum, v) => sum + v, 0));
  }

  const result = assemble(months, groups, rows, detail, {
    absolute: true,
    unclassifiedGroup: "unclassified",
  });

  /**
   * Splice the profit-for-the-period line in under Reserves & Surplus, together
   * with any prior-year P&L balances the opening trial balance carried.
   *
   * assemble() drops a group nothing sits in, so a company with no reserves
   * account carrying a balance - which is every company whose opening trial
   * balance has not landed - has no heading to splice under. Hanging the profit
   * off a line that may not exist loses the whole year's result from equity and
   * puts the statement out by exactly that much, so the heading is created here
   * when it is missing rather than the profit being dropped. A year with
   * nothing in it still gets nothing: the heading is raised to carry a figure,
   * not to stand empty.
   */
  const carriesResult =
    Math.abs(broughtForward) > 0.005 ||
    months.some((m) => Math.abs(profitLine[m.key]) > 0.005);
  const reservesGroup = groups.find((g) => g.code === "reserves");
  if (
    reservesGroup &&
    carriesResult &&
    !result.lines.some((l) => l.groupCode === "reserves" && l.level === 0)
  ) {
    const heading: StatementLine = {
      key: reservesGroup.code,
      name: reservesGroup.name,
      level: 0,
      isSubtotal: false,
      sign: reservesGroup.sign,
      groupCode: reservesGroup.code,
      accountId: null,
      values: emptyValues(months),
    };
    // In its own place in the running order, not appended at the foot.
    const sortOf = new Map(groups.map((g) => [g.code, g.sort_order]));
    let at = result.lines.findIndex(
      (l) => l.level === 0 && (sortOf.get(l.groupCode ?? "") ?? 0) > reservesGroup.sort_order,
    );
    if (at < 0) at = result.lines.length;
    result.lines.splice(at, 0, heading);
  }

  const reservesIndex = result.lines.findIndex((l) => l.groupCode === "reserves" && l.level === 0);
  if (reservesIndex >= 0) {
    const reserves = result.lines[reservesIndex];
    const extra: StatementLine[] = [];

    if (Math.abs(broughtForward) > 0.005) {
      const carried = emptyValues(months);
      for (const m of months) carried[m.key] = broughtForward;
      for (const m of months) reserves.values[m.key] += broughtForward;
      extra.push({
        key: "brought_forward",
        name: "Prior-year P&L balances brought forward",
        level: 1,
        isSubtotal: false,
        sign: -1,
        groupCode: "reserves",
        accountId: null,
        values: carried,
      });
    }

    for (const m of months) reserves.values[m.key] += profitLine[m.key];
    extra.push({
      key: "profit_for_period",
      name: "Profit for the period",
      level: 1,
      isSubtotal: false,
      sign: -1,
      groupCode: "reserves",
      accountId: null,
      values: profitLine,
    });

    result.lines.splice(reservesIndex + 1, 0, ...extra);
    recomputeSubtotals(result.lines, groups, months);
  }

  if (consolidating && months.some((m) => Math.abs(elimination[m.key]) > 0.005)) {
    const target = result.lines.findIndex((l) => l.groupCode === "other_liab" && l.level === 0);
    const host =
      target >= 0
        ? result.lines[target]
        : ({
            key: "other_liab",
            name: "Other Liabilities & Provisions",
            level: 0,
            isSubtotal: false,
            sign: -1,
            groupCode: "other_liab",
            accountId: null,
            values: emptyValues(months),
          } satisfies StatementLine);

    if (target < 0) {
      // No other liabilities at all in this period: put the heading where it
      // belongs, immediately above the total it feeds, not at the end.
      const total = result.lines.findIndex((l) => l.groupCode === "total_eq_liab");
      result.lines.splice(total >= 0 ? total : result.lines.length, 0, host);
    }
    for (const m of months) host.values[m.key] += elimination[m.key];

    const at = result.lines.indexOf(host);
    result.lines.splice(at + 1, 0, {
      key: "intercompany_difference",
      name: "Unreconciled intercompany difference",
      level: 1,
      isSubtotal: false,
      sign: -1,
      groupCode: "other_liab",
      accountId: null,
      values: elimination,
    });
    recomputeSubtotals(result.lines, groups, months);
  }

  // assemble() totals unmapped activity across every month, which is right for
  // the P&L - twelve months of trading add up. A balance sheet row is the same
  // balance restated each month end, so summing it counts the same money twelve
  // times. What is unclassified is what stands there at the close.
  const unclassified = result.lines.find((l) => l.groupCode === "unclassified" && l.level === 0);
  if (unclassified) {
    const closing = Math.abs(unclassified.values[months[months.length - 1].key] ?? 0);
    result.unmappedTotal = closing;
    result.hasUnmapped = closing > 0.005;
  }

  return { ...result, eliminations: consolidating ? { removed, difference } : undefined };
}

/* ============================================================
   Shared assembly
   ============================================================ */

export interface FlatRow {
  month_key: string;
  group_code: string | null;
  account_id: number;
  account_name: string;
  account_sort: number;
  amount: number;
}

export function assemble(
  months: FyMonth[],
  groups: GroupRow[],
  rows: FlatRow[],
  detail: boolean,
  opts: { absolute?: boolean; unclassifiedGroup?: string } = {},
): StatementResult {
  const validMonths = new Set(months.map((m) => m.key));
  const knownGroups = new Set(groups.map((g) => g.code));
  const fallback =
    opts.unclassifiedGroup && knownGroups.has(opts.unclassifiedGroup)
      ? opts.unclassifiedGroup
      : null;

  // account id -> its line, and group code -> accounts under it
  const accountLines = new Map<number, StatementLine>();
  const byGroup = new Map<string, Set<number>>();
  let unmappedTotal = 0;
  let hasUnmapped = false;

  for (const row of rows) {
    if (!validMonths.has(row.month_key)) continue;

    let group = row.group_code && knownGroups.has(row.group_code) ? row.group_code : null;
    if (!group) {
      hasUnmapped = true;
      unmappedTotal += Math.abs(row.amount);
      // Shown under "Unclassified" where the statement has such a line, so the
      // total still ties and the reader can see what has not been placed.
      // Without one there is nowhere to put it and it stays out.
      if (!fallback) continue;
      group = fallback;
    }

    let line = accountLines.get(row.account_id);
    if (!line) {
      line = {
        key: `acct:${row.account_id}`,
        name: row.account_name,
        level: 1,
        isSubtotal: false,
        sign: groups.find((g) => g.code === group)?.sign ?? 1,
        groupCode: group,
        accountId: row.account_id,
        values: emptyValues(months),
      };
      accountLines.set(row.account_id, line);
      if (!byGroup.has(group)) byGroup.set(group, new Set());
      byGroup.get(group)!.add(row.account_id);
    }
    line.values[row.month_key] += row.amount;
  }

  // Drop accounts with no activity at all - an empty ledger account is noise.
  for (const [id, line] of accountLines) {
    const anyValue = months.some((m) => Math.abs(line.values[m.key]) > 0.005);
    if (!anyValue) {
      accountLines.delete(id);
      if (line.groupCode) byGroup.get(line.groupCode)?.delete(id);
    }
  }

  const lines: StatementLine[] = [];

  for (const group of groups) {
    const groupLine: StatementLine = {
      key: group.code,
      name: group.name,
      level: 0,
      isSubtotal: group.is_subtotal,
      sign: group.sign,
      groupCode: group.code,
      accountId: null,
      values: emptyValues(months),
    };

    if (!group.is_subtotal) {
      const ids = byGroup.get(group.code) ?? new Set<number>();
      const children = [...ids]
        .map((id) => accountLines.get(id)!)
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const child of children) {
        for (const m of months) groupLine.values[m.key] += child.values[m.key];
      }

      // A group with nothing in it is omitted entirely rather than shown as zero.
      const anyValue = months.some((m) => Math.abs(groupLine.values[m.key]) > 0.005);
      if (!anyValue && children.length === 0) continue;

      lines.push(groupLine);
      if (detail) lines.push(...children);
      continue;
    }

    lines.push(groupLine);
  }

  recomputeSubtotals(lines, groups, months);

  if (opts.absolute) {
    // Balance-sheet lines are point-in-time, so a zero opening month is real
    // information; nothing further to do here.
  }

  return { months, lines, hasUnmapped, unmappedTotal };
}

/** Fill in every subtotal line by summing the groups it references, in order. */
export function recomputeSubtotals(lines: StatementLine[], groups: GroupRow[], months: FyMonth[]) {
  const byCode = new Map<string, StatementLine>();
  for (const line of lines) {
    if (line.level === 0 && line.groupCode) byCode.set(line.groupCode, line);
  }

  for (const group of groups) {
    if (!group.is_subtotal || !group.subtotal_of) continue;
    const target = byCode.get(group.code);
    if (!target) continue;

    for (const m of months) target.values[m.key] = 0;
    for (const sourceCode of group.subtotal_of) {
      const source = byCode.get(sourceCode);
      if (!source) continue;
      for (const m of months) target.values[m.key] += source.values[m.key];
    }
  }
}
