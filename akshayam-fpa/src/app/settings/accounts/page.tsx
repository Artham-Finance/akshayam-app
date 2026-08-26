import { AccountMapper, type AccountRow, type GroupOption } from "@/components/AccountMapper";
import { SetupRequired } from "@/components/SetupRequired";
import { CompanyOnly, EmptyState, Notice, PageHeader } from "@/components/ui";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";

export const dynamic = "force-dynamic";

export default async function AccountMappingPage() {
  try {
    const entity = await getEntity();
    if (entity.isGroup) {
      return (
        <>
          <PageHeader title="Account mapping" />
          <CompanyOnly what="The chart of accounts" />
        </>
      );
    }

    const [accounts, groups] = await Promise.all([
      query<{
        id: number;
        name: string;
        zoho_type: string | null;
        statement: "pnl" | "bs" | "cf" | "none";
        group_code: string | null;
        is_mapped: boolean;
        activity: number;
      }>(
        // Materiality has to include opening balances, not just ledger
        // movement: an account that only ever appeared in the trial balance
        // still carries a real balance and must not sort to the bottom.
        `select a.id, a.name, a.zoho_type, a.statement, a.group_code, a.is_mapped,
                (coalesce(gl.act, 0) + coalesce(ob.act, 0))::numeric as activity
           from accounts a
           left join (
             select account_id, sum(abs(debit - credit)) as act
               from gl_entries where entity_id = $1 group by account_id
           ) gl on gl.account_id = a.id
           left join (
             select account_id, sum(abs(debit - credit)) as act
               from opening_balances where entity_id = $1 group by account_id
           ) ob on ob.account_id = a.id
          where a.entity_id = $1
          order by a.is_mapped, activity desc, a.name`,
        [entity.id],
      ),
      query<{ statement: "pnl" | "bs"; code: string; name: string }>(
        `select statement::text as statement, code, name
           from report_groups
          where entity_id = $1 and statement in ('pnl','bs') and is_subtotal = false
          order by statement, sort_order`,
        [entity.id],
      ),
    ]);

    if (accounts.length === 0) {
      return (
        <>
          <PageHeader title="Account mapping" />
          <EmptyState title="No accounts discovered yet" href="/upload" cta="Upload the general ledger">
            Ledger accounts appear here the first time a general ledger or trial balance is
            uploaded. Each one gets a suggested reporting line that you can correct.
          </EmptyState>
        </>
      );
    }

    const rows: AccountRow[] = accounts.map((a) => ({
      id: a.id,
      name: a.name,
      zohoType: a.zoho_type,
      statement: a.statement,
      groupCode: a.group_code,
      isMapped: a.is_mapped,
      activity: Number(a.activity),
    }));

    const options: GroupOption[] = groups.map((g) => ({
      statement: g.statement,
      code: g.code,
      name: g.name,
    }));

    return (
      <>
        <PageHeader
          title="Account mapping"
          subtitle="Where each Zoho ledger account appears in the statements. Set once; every future upload inherits it."
        />

        <div className="space-y-4">
          <Notice tone="info" title="Why this screen exists">
            Zoho knows an account is an &ldquo;Expense&rdquo;, but not whether it belongs in
            direct costs, employee costs or admin. That judgement is yours, and it is what
            makes the P&amp;L read the way management expects. Anything new that appears in a
            future upload is flagged here rather than being absorbed silently.
          </Notice>

          <AccountMapper accounts={rows} groups={options} />
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}
