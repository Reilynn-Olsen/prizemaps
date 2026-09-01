import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApproveButton } from "./approve-button";

export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = code ? `/cli-auth?code=${encodeURIComponent(code)}` : "/cli-auth";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!code) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Missing code</h1>
        <p className="text-sm text-neutral-500">
          Run{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
            prize-maps login
          </code>{" "}
          again — it prints a link with the code already included.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Connect prize-maps</h1>
      <p className="text-sm text-neutral-500">
        Signed in as {user.email}. Approve this code to let the watcher on your
        machine upload matches on your behalf.
      </p>
      <p className="text-center font-mono text-3xl tracking-[0.3em]">{code}</p>
      <ApproveButton code={code} />
    </main>
  );
}
