import "server-only";

import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
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

/** Transfers into savings or investments, which are not spending. */
const SAVINGS_CATEGORY = "savings";

export type CategorySpend = {
  category: string;
  label: string;
  amountMinor: number;
  priorAverageMinor: number | null;
  /** Highest of the individual baseline windows, used to reject ordinary noise. */
  priorMaxMinor: number | null;
  changePct: number | null;
};

/**
 * Spending by category for the last 30 days, each compared against its own
 * baseline over the 90 days before that.
 *
 * The baseline is three consecutive 30-day windows, not calendar months.
 * Calendar months are the obvious choice and the wrong one: the window at each
 * end is partial, which drags the average down and makes ordinary spending
 * look like a spike in every category at once.
 */
export async function getSpendingByCategory(userId: string): Promise<CategorySpend[]> {
  const today = startOfDay(new Date());

  /** Total spend per category between two day offsets. */
  async function spendBetween(fromOffset: number, toOffset: number) {
    const rows = await db
      .select({
        category: transactions.category,
        total: sql<number>`sum(-${transactions.amountMinor})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          gte(transactions.date, isoDate(addDays(today, fromOffset))),
          lt(transactions.date, isoDate(addDays(today, toOffset))),
          sql`${transactions.amountMinor} < 0`,
        ),
      )
      .groupBy(transactions.category);
    return new Map(rows.map((r) => [r.category, Number(r.total ?? 0)]));
  }

  const [recent, ...priorWindows] = await Promise.all([
    spendBetween(-30, 1),
    spendBetween(-60, -30),
    spendBetween(-90, -60),
    spendBetween(-120, -90),
  ]);

  return [...recent.entries()]
    .map(([category, amountMinor]) => {
      // A window with no spending at all in this category is not evidence of a
      // zero baseline; it usually means the history does not reach that far.
      const samples = priorWindows
        .map((window) => window.get(category))
        .filter((v): v is number => v !== undefined && v > 0);

      const priorAverageMinor = samples.length >= 2 ? mean(samples) : null;

      return {
        category,
        label: titleCase(category),
        amountMinor,
        priorAverageMinor,
        priorMaxMinor: samples.length >= 2 ? Math.max(...samples) : null,
        changePct:
          priorAverageMinor && priorAverageMinor > 0
            ? ((amountMinor - priorAverageMinor) / priorAverageMinor) * 100
            : null,
      };
    })
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export type TrailingCashflow = {
  incomeMinor: number;
  /** Actual spending, with savings and investment transfers excluded. */
  expenseMinor: number;
  transferredMinor: number;
  netMinor: number;
  savingsRate: number | null;
  priorSavingsRate: number | null;
  hasData: boolean;
};

/**
 * Income and spending over the last 30 days, and the 30 before that.
 *
 * Used for the headline savings rate instead of the calendar month, because a
 * month-to-date figure on the 9th reports "no income" for anyone paid at the
 * end of the month — technically true, and completely useless.
 */
export type RangeCashflow = {
  incomeMinor: number;
  /** Actual spending, with savings and investment transfers excluded. */
  expenseMinor: number;
  transferredMinor: number;
  savingsRate: number | null;
};

/**
 * Income, spending and savings rate over an arbitrary half-open date range.
 * Every other cashflow figure in the app is built from this, so a review and
 * the dashboard can never disagree about what a period contained.
 */
export async function getCashflowForRange(
  userId: string,
  fromISO: string,
  toISO: string,
): Promise<RangeCashflow> {
  const [row] = await db
    .select({
      income: sql<number>`sum(case when ${transactions.amountMinor} > 0 then ${transactions.amountMinor} else 0 end)`,
      expense: sql<number>`sum(case when ${transactions.amountMinor} < 0 then -${transactions.amountMinor} else 0 end)`,
      // Money moved into savings or investments has left the current account
      // but has not been spent. Counting it as an expense would make saving
      // more look like saving less, which is exactly backwards.
      transferred: sql<number>`sum(case when ${transactions.amountMinor} < 0 and ${transactions.category} = ${SAVINGS_CATEGORY} then -${transactions.amountMinor} else 0 end)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        gte(transactions.date, fromISO),
        lt(transactions.date, toISO),
      ),
    );

  const incomeMinor = Number(row?.income ?? 0);
  const transferredMinor = Number(row?.transferred ?? 0);
  const spentMinor = Number(row?.expense ?? 0) - transferredMinor;

  return {
    incomeMinor,
    expenseMinor: spentMinor,
    transferredMinor,
    savingsRate: incomeMinor > 0 ? (incomeMinor - spentMinor) / incomeMinor : null,
  };
}

export async function getTrailingCashflow(userId: string): Promise<TrailingCashflow> {
  const today = startOfDay(new Date());
  const at = (offset: number) => isoDate(addDays(today, offset));

  const [recent, prior] = await Promise.all([
    getCashflowForRange(userId, at(-30), at(1)),
    getCashflowForRange(userId, at(-60), at(-30)),
  ]);

  return {
    incomeMinor: recent.incomeMinor,
    expenseMinor: recent.expenseMinor,
    transferredMinor: recent.transferredMinor,
    netMinor: recent.incomeMinor - recent.expenseMinor,
    savingsRate: recent.savingsRate,
    priorSavingsRate: prior.savingsRate,
    hasData: recent.incomeMinor > 0 || recent.expenseMinor > 0,
  };
}

export type SpendAnomaly = CategorySpend & { changePct: number; priorMaxMinor: number };

/**
 * Categories running materially above their own recent baseline.
 *
 * Three conditions must all hold, and each one exists to kill a specific kind
 * of false positive:
 *
 *  - above the baseline average by `thresholdPct`, so small drifts stay quiet;
 *  - above a real amount, so a $6 category doubling to $12 is never an event;
 *  - above *every* individual baseline window, not just their average.
 *
 * The last one matters most. Discretionary spending in any single category is
 * naturally lumpy, and month-to-month swings of 30% are ordinary noise. Testing
 * against the mean alone flags several categories at once and trains the reader
 * to ignore the panel, which is worse than not having it.
 */
export async function getSpendingAnomalies(
  userId: string,
  thresholdPct = 20,
  minimumMinor = 5_000,
): Promise<SpendAnomaly[]> {
  const categories = await getSpendingByCategory(userId);
  return categories
    .filter(
      (c): c is SpendAnomaly =>
        c.changePct !== null &&
        c.priorMaxMinor !== null &&
        c.changePct >= thresholdPct &&
        c.amountMinor >= minimumMinor &&
        c.amountMinor > c.priorMaxMinor &&
        c.category !== SAVINGS_CATEGORY,
    )
    .sort((a, b) => b.changePct - a.changePct);
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
  const [netWorth, cashflow, categories, anomalies, trailing] = await Promise.all([
    getNetWorth(userId),
    getCashflow(userId),
    getSpendingByCategory(userId),
    getSpendingAnomalies(userId),
    getTrailingCashflow(userId),
  ]);
  const current = cashflow.at(-1) ?? null;
  return { netWorth, cashflow, categories, anomalies, current, trailing };
}
