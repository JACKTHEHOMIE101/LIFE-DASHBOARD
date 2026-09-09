import type { Metadata } from "next";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { reviews } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { reviewPeriod } from "@/lib/domain/reviews";
import { aiConfigured } from "@/lib/ai/chief-of-staff";
import { ReviewsView } from "@/components/reviews/reviews-view";
import { PageHeader } from "@/components/ui/primitives";
import { isoDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const generate = Array.isArray(params.generate) ? params.generate[0] : params.generate;

  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.userId, user.id), isNull(reviews.archivedAt), isNull(reviews.deletedAt)))
    .orderBy(desc(reviews.periodStart))
    .limit(24);

  const lastWeek = isoDate(reviewPeriod("weekly", user.settings.weekStartsOn, -1).start);
  const lastMonth = isoDate(reviewPeriod("monthly", user.settings.weekStartsOn, -1).start);

  return (
    <div className="animate-in">
      <PageHeader
        title="Reviews"
        description="Numbers are computed from your data. The words around them are a starting point you can rewrite."
      />
      <ReviewsView
        reviews={rows}
        aiEnabled={aiConfigured()}
        pendingWeekly={!rows.some((r) => r.type === "weekly" && r.periodStart === lastWeek)}
        pendingMonthly={!rows.some((r) => r.type === "monthly" && r.periodStart === lastMonth)}
        autoGenerate={generate === "weekly" || generate === "monthly" ? generate : null}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
