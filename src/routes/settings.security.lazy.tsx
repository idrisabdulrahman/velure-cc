import { createLazyFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { toast } from "#/components/ui/use-toast";
import { authClient } from "#/lib/auth-client";

export const Route = createLazyFileRoute("/settings/security")({
  component: SecuritySettingsPage,
});

type AuthAccount = {
  id: string;
  providerId: string;
  accountId: string;
};

function SecuritySettingsPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const [accounts, setAccounts] = useState<AuthAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const linkedGoogle = useMemo(
    () => accounts.some((account) => account.providerId === "google"),
    [accounts],
  );

  const linkedCredential = useMemo(
    () => accounts.some((account) => account.providerId === "credential"),
    [accounts],
  );

  const refreshData = async () => {
    setLoading(true);
    setErrorMessage(null);

    const accountsResult = await authClient.listAccounts();

    if (accountsResult.error) {
      setErrorMessage(accountsResult.error.message ?? "Could not load account data.");
      setLoading(false);
      return;
    }

    setAccounts((accountsResult.data ?? []) as AuthAccount[]);
    setLoading(false);
  };

  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("linked");
    if (linked === "google") {
      toast({
        title: "Google linked",
        description: "Your Google account is now linked.",
        variant: "success",
      });
    }

    void refreshData();
  }, []);

  const linkGoogle = async () => {
    setLinkingGoogle(true);
    setErrorMessage(null);

    try {
      const callbackURL =
        typeof window !== "undefined"
          ? `${window.location.origin}/settings/security?linked=google`
          : "/settings/security?linked=google";

      await authClient.linkSocial({
        provider: "google",
        callbackURL,
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not start Google account linking.",
      );
    } finally {
      setLinkingGoogle(false);
    }
  };

  const unlinkAccount = async (providerId: string, accountId: string) => {
    const result = await authClient.unlinkAccount({ providerId, accountId });
    if (result.error) {
      toast({
        title: "Could not unlink account",
        description: result.error.message ?? "Unknown error",
        variant: "error",
      });
      return;
    }

    toast({
      title: "Account unlinked",
      description: `${providerId} was removed.`,
      variant: "success",
    });
    await refreshData();
  };

  if (sessionPending || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#a7bc62]" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="rounded-md border border-[#2b2d30] bg-[#17191b] p-6 text-sm text-[#a29b90]">
        Sign in to manage security settings.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[#ece7de]">Security</h1>
        <p className="mt-2 text-sm text-[#a29b90]">
          Manage the sign-in providers attached to this account.
        </p>
      </div>

      <section className="ui-panel rounded-md border border-[#2b2d30] bg-[#17191b]">
        <div className="flex items-center justify-between gap-3 border-b border-[#2b2d30] px-5 py-4">
          <p className="text-sm font-medium text-[#ece7de]">Linked sign-in providers</p>
          <Button
            type="button"
            onClick={() => {
              void refreshData();
            }}
            variant="outline"
            className="h-9 rounded-md border-[#2b2d30] bg-transparent text-sm text-[#d5d0c7] hover:bg-[#1d2023]"
          >
            Refresh
          </Button>
        </div>

        <div className="space-y-3 px-5 py-5">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium capitalize text-[#ece7de]">
                  {account.providerId}
                </p>
                <p className="text-xs text-[#a29b90]">{account.accountId}</p>
              </div>
              {account.providerId !== "credential" && linkedCredential ? (
                <Button
                  type="button"
                  onClick={() => {
                    void unlinkAccount(account.providerId, account.accountId);
                  }}
                  variant="outline"
                  className="h-9 rounded-md border-[#5d4747] bg-transparent text-sm text-[#d48f8f] hover:bg-[#2a1f1f]"
                >
                  Unlink
                </Button>
              ) : null}
            </div>
          ))}

          {!linkedGoogle ? (
            <div className="rounded-md border border-[#2b2d30] bg-[#121314] p-4">
              <p className="text-sm font-medium text-[#ece7de]">Link your Google account</p>
              <p className="mt-1 text-sm text-[#a29b90]">
                Add Google as another way to access this account.
              </p>
              <Button
                type="button"
                onClick={() => {
                  void linkGoogle();
                }}
                disabled={linkingGoogle}
                className="mt-4 h-10 rounded-md bg-[#a7bc62] px-4 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
              >
                {linkingGoogle ? "Redirecting..." : "Link Google account"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-[#8f9e66]">Google is already linked to this account.</p>
          )}
        </div>
      </section>

      {errorMessage ? (
        <p className="rounded-md border border-[#5d4747] bg-[#2a1f1f] px-4 py-3 text-sm text-[#efb1b1]">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
