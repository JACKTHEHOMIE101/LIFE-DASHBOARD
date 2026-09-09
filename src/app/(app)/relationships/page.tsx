import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listPeople, getUpcomingDates } from "@/lib/domain/relationships";
import { RelationshipsView } from "@/components/relationships/relationships-view";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Relationships" };

export default async function RelationshipsPage() {
  const user = await requireUser();
  const [people, upcoming] = await Promise.all([
    listPeople(user.id),
    getUpcomingDates(user.id, 60),
  ]);

  return (
    <div className="animate-in">
      <PageHeader
        title="Relationships"
        description="A cadence is something you set. Time passing on its own is never treated as a problem."
      />
      <RelationshipsView
        people={people}
        upcoming={upcoming.map((p) => ({
          id: p.id,
          name: p.name,
          daysUntilBirthday: p.daysUntilBirthday ?? 0,
        }))}
      />
    </div>
  );
}
