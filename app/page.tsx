import { MailApp } from "@/components/mail-app";
import { listMailAccounts } from "@/lib/mail-accounts";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialAccounts = await listMailAccounts();

  return <MailApp initialAccounts={initialAccounts} />;
}
