import { redirect } from "next/navigation";
import { RepoFeed } from "@/components/repo-feed";
import { getSession } from "@/lib/session";

export default async function FeedPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <RepoFeed />;
}
