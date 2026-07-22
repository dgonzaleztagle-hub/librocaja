import { AppShell } from "@/components/app-shell";
import { Portfolio } from "@/components/portfolio";
import { listCompanies } from "@/lib/data";

export default async function PortfolioPage() {
  const companies = await listCompanies();
  return <AppShell active="portfolio"><Portfolio initialCompanies={companies} /></AppShell>;
}
