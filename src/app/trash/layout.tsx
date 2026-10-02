import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default async function TrashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <Suspense>
      <AppShell user={user}>{children}</AppShell>
    </Suspense>
  );
}
