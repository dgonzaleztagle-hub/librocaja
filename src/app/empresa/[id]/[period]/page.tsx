import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Workspace } from "@/components/workspace";
import { getWorkspace } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CompanyPeriodPage({
  params,
}: {
  params: Promise<{ id: string; period: string }>;
}) {
  const { id, period } = await params;
  const data = await getWorkspace(id, period);
  if (!data) notFound();
  return (
    <AppShell active="workspace">
      <Workspace
        company={data.company}
        period={period}
        initialMovements={data.movements}
        initialDocuments={data.documents}
        initialClosure={data.closure}
      />
    </AppShell>
  );
}
