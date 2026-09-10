import type { Metadata } from "next";
import { AlertTriangle, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getFinanceOverview, getRecentTransactions } from "@/lib/domain/finances";
import { Card, CardHeader, DemoBadge, EmptyState, LinkButton, PageHeader } from "@/components/ui/primitives";
import { MiniBars, RankedBars, StatTile, TrendIndicator } from "@/components/ui/charts";
import { cn, formatMoney, pct, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Finances" };

export default async function FinancesPage() {
  const user = await requireUser();
  const [overview, recent] = await Promise.all([
    getFinanceOverview(user.id),
    getRecentTransactions(user.id, 20),
  ]);

  const { netWorth, cashflow, categories, anomalies, trailing } = overview;
  // Trailing 30 days rather than month-to-date: a partial month reports no
  // income for anyone paid at the end of it.
  const savingsDelta =
    trailing.savingsRate != null && trailing.priorSavingsRate != null
      ? (trailing.savingsRate - trailing.priorSavingsRate) * 100
      : null;

  if (!netWorth.hasData) {
    return (
      <div className="animate-in">
        <PageHeader title="Finances" description="Net worth, cash flow and spending patterns." />
        <Card>
          <EmptyState
            icon={<Wallet className="size-5" />}
            title="No accounts connected"
            description="Connect an account through Plaid or add balances manually. Credentials are never stored in this database."
            action={
              <LinkButton href="/integrations" size="sm" variant="primary">
                Connect an account
              </LinkButton>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <PageHeader
        title="Finances"
        description="Balances and patterns. Account credentials are never stored here."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          {/* The one hero figure on this page. */}
          <p className="text-[13px] text-ink-muted">Net worth</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            {formatMoney(netWorth.netMinor)}
          </p>
          <p className="mt-1 text-[13px] text-ink-subtle">
            {formatMoney(netWorth.assetsMinor)} assets · {formatMoney(netWorth.liabilitiesMinor)}{" "}
            liabilities
          </p>
        </Card>

        <Card className="p-4">
          <StatTile
            label="Savings rate"
            value={
              trailing.savingsRate != null ? `${Math.round(trailing.savingsRate * 100)}%` : "No income recorded"
            }
            delta={
              savingsDelta !== null && Math.abs(savingsDelta) >= 1 ? (
                <TrendIndicator direction={savingsDelta > 0 ? "up" : "down"}>
                  {pct(savingsDelta, 0)} vs prior 30 days
                </TrendIndicator>
              ) : undefined
            }
            sub={`Last 30 days · ${formatMoney(trailing.incomeMinor)} in, ${formatMoney(trailing.expenseMinor)} out`}
          />
        </Card>

        <Card className="p-4">
          <StatTile
            label="Net, last 30 days"
            value={formatMoney(trailing.netMinor)}
            chart={
              cashflow.length > 1 ? (
                <MiniBars
                  data={cashflow.map((m) => ({
                    label: m.month,
                    value: Math.max(m.netMinor, 0),
                  }))}
                  height={36}
                  formatValue={(v) => formatMoney(v)}
                />
              ) : undefined
            }
            sub={`${cashflow.length} months of history`}
          />
        </Card>
      </div>

      {anomalies.length > 0 ? (
        <Card className="mb-5 border-caution/30 bg-caution-soft/30 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" />
            <div>
              <p className="text-sm font-medium text-ink">Unusual spending</p>
              <ul className="mt-1 space-y-0.5">
                {anomalies.map((a) => (
                  <li key={a.category} className="text-[13px] text-ink-muted">
                    {a.label} is {pct(a.changePct, 0)} above its 3-month average (
                    {formatMoney(a.amountMinor)} in the last 30 days).
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Spending by category" description="Last 30 days" />
          <div className="border-t border-border px-5 py-4">
            <RankedBars
              data={categories.slice(0, 8).map((c) => ({
                label: c.label,
                value: c.amountMinor,
                tone: c.changePct !== null && c.changePct >= 20 ? "caution" : "accent",
                note:
                  c.changePct !== null
                    ? `${pct(c.changePct, 0)} vs 3-month average`
                    : "No baseline yet",
              }))}
              formatValue={(v) => formatMoney(v)}
            />
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Accounts" />
            <ul className="divide-y divide-border border-t border-border px-5">
              {netWorth.accounts.map((account) => (
                <li key={account.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 truncate text-sm text-ink">
                      {account.name}
                      {account.isDemo ? <DemoBadge /> : null}
                    </span>
                    <span className="text-[12px] text-ink-subtle">
                      {account.institution ?? "Manual"} · {titleCase(account.type)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-medium tabular",
                      account.isLiability ? "text-critical" : "text-ink",
                    )}
                    data-numeric
                  >
                    {account.isLiability ? "−" : ""}
                    {formatMoney(account.balanceMinor)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Recent transactions" />
            <ul className="divide-y divide-border border-t border-border px-5">
              {recent.map(({ transaction, accountName }) => (
                <li key={transaction.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{transaction.description}</span>
                    <span className="text-[12px] text-ink-subtle">
                      {transaction.date} · {titleCase(transaction.category)}
                      {accountName ? ` · ${accountName}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-medium tabular",
                      transaction.amountMinor > 0 ? "text-positive" : "text-ink",
                    )}
                    data-numeric
                  >
                    {transaction.amountMinor > 0 ? "+" : "−"}
                    {formatMoney(Math.abs(transaction.amountMinor))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
