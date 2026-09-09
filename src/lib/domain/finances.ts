import "server-only";

import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { financialAccounts, transactions } from "@/db/schema";
import { addDays, isoDate, mean, startOfDay, titleCase } from "@/lib/utils";

export type NetWorth = {
  assetsMinor: number;
  liabilitiesMinor: number;
  netMinor: number;
  accounts: (typeof financialAccounts.$inferSelect)[];
  hasData: boolean;
};

export async function getNetWorth(userId: string): Promise<NetWorth> {
  const accounts = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.userId, userId), isNull(financialAccounts.deletedAt)))
    .orderBy(desc(financialAccounts.balanceMinor));

  // Liabilities are stored as positive balances and subtracted here, so an
  // account's own balance always reads the way a statement would show it.
  const assetsMinor = accounts
    .filter((a) => !a.isLiability)
    .reduce((sum, a) => sum + a.balanceMinor, 0);
  const liabilitiesMinor = accounts
    .filter((a) => a.isLiability)
    .reduce((sum, a) => sum + a.balanceMinor, 0);

  return {
    assetsMinor,
    liabilitiesMinor,
    netMinor: assetsMinor - liabilitiesMinor,
    accounts,
    hasData: accounts.length > 0,
  };
}

export type MonthlyCashflow = {
  month: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  savingsRate: number | null;
};

/** Income, spend and savings rate per calendar month, oldest first. */
export async function getCashflow(userId: string, months = 6): Promise<MonthlyCashflow[]> {
  const since = isoDate(addDays(startOfDay(new Date()), -months * 31));
  const rows = await db
    .select({
      month: sql<string>`substr(${transactions.date}, 1, 7)`,
      income: sql<number>`sum(case when ${transactions.amountMinor} > 0 then ${transactions.amountMinor} else 0 end)`,
      expense: sql<number>`sum(case when ${transactions.amountMinor} < 0 then -${transactions.amountMinor} else 0 end)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        gte(transactions.date, since),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return rows.map((r) => {
    const incomeMinor = Number(r.income ?? 0);
    const expenseMinor = Number(r.expense ?? 0);
    return {
      month: r.month,
      incomeMinor,
      expenseMinor,
      netMinor: incomeMinor - expenseMinor,
      // Undefined rather than 0 in a month with no income recorded.
      savingsRate: incomeMinor > 0 ? (incomeMinor - expenseMinor) / incomeMinor : null,
    };
  });
}

export type CategorySpend = {
  category: string;
  label: string;
  amountMinor: number;
  priorAverageMinor: number | null;
  changePct: number | null;
};

/**
 * Spending by category for the last 30 days, each compared against its own
 * average over the three months before that.
 */
export async function getSpendingByCategory(userId: string): Promise<CategorySpend[]> {
  const today = startOfDay(new Date());
  const recentFrom = isoDate(addDays(today, -30));
  const priorFrom = isoDate(addDays(today, -120));

  const [recent, prior] = await Promise.all([
    db
      .select({
        category: transactions.category,
        total: sql<number>`sum(-${transactions.amountMinor})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          gte(transactions.date, recentFrom),
          sql`${transactions.amountMinor} < 0`,
        ),
      )
      .groupBy(transactions.category),
    db
      .select({
        category: transactions.category,
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        total: sql<number>`sum(-${transactions.amountMinor})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          gte(transactions.date, priorFrom),
          lte(transactions.date, recentFrom),
          sql`${transactions.amountMinor} < 0`,
        ),
      )
      .groupBy(transactions.category, sql`2`),
  ]);

  const priorByCategory = new Map<string, number[]>();
  for (const row of prior) {
    priorByCategory.set(row.category, [
      ...(priorByCategory.get(row.category) ?? []),
      Number(row.total ?? 0),
    ]);
  }

  return recent
    .map((row) => {
      const amountMinor = Number(row.total ?? 0);
      const priorMonths = priorByCategory.get(row.category) ?? [];
      // One prior month is not an average worth comparing against.
      const priorAverageMinor = priorMonths.length >= 2 ? mean(priorMonths) : null;
      return {
        category: row.category,
        label: titleCase(row.category),
        amountMinor,
        priorAverageMinor,
        changePct:
          priorAverageMinor && priorAverageMinor > 0
            ? ((amountMinor - priorAverageMinor) / priorAverageMinor) * 100
            : null,
      };
    })
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export type SpendAnomaly = CategorySpend & { changePct: number };

/**
 * Categories running materially above their own recent baseline.
 *
 * Requires both a meaningful percentage and a meaningful absolute amount, so a
 * £6 category doubling to £12 never gets reported as a financial event.
 */
export async function getSpendingAnomalies(
  userId: string,
  thresholdPct = 20,
  minimumMinor = 5_000,
): Promise<SpendAnomaly[]> {
  const categories = await getSpendingByCategory(userId);
  return categories.filter(
    (c): c is SpendAnomaly =>
      c.changePct !== null &&
      c.changePct >= thresholdPct &&
      c.amountMinor >= minimumMinor &&
      c.category !== "savings",
  );
}

export async function getRecentTransactions(userId: string, limit = 25) {
  return db
    .select({
      transaction: transactions,
      accountName: financialAccounts.name,
    })
    .from(transactions)
    .leftJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit);
}

export async function getFinanceOverview(userId: string) {
  const [netWorth, cashflow, categories, anomalies] = await Promise.all([
    getNetWorth(userId),
    getCashflow(userId),
    getSpendingByCategory(userId),
    getSpendingAnomalies(userId),
  ]);
  const current = cashflow.at(-1) ?? null;
  return { netWorth, cashflow, categories, anomalies, current };
}
