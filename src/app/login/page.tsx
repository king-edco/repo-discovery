import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/session";
import { configuredOAuthProviders } from "@/lib/auth";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/feed");
  return <AuthForm mode="login" providers={configuredOAuthProviders()} />;
}
