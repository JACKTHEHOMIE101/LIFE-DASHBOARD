"use server";

import { requireUser } from "@/lib/auth";
import { globalSearch, type SearchHit } from "@/lib/domain/search";

export async function searchAction(query: string): Promise<SearchHit[]> {
  const user = await requireUser();
  return globalSearch(user.id, query);
}
