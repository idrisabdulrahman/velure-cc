import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { toast } from "#/components/ui/use-toast";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/settings/security")({
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
			setErrorMessage(
				accountsResult.error.message ?? "Could not load account data.",
			);
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
				error instanceof Error
					? error.message
					: "Could not start Google account linking.",
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
				<Loader2 className="h-6 w-6 animate-spin text-[#C8FF1A]" />
			</div>
		);
	}

	if (!session?.user) {
		return (
			<div className="rounded-xl border border-[#1A1D22] bg-[#0A0D12] p-6 text-sm text-[#A7AFBC]">
				Sign in to manage security settings.
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-3xl space-y-6">
			<div>
				<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#C8FF1A]">
					Account Security
				</p>
				<h1 className="mt-2 font-serif text-4xl text-[#F2F3F5]">
					Security Center
				</h1>
				<p className="mt-2 text-sm text-[#8A8F99]">
					Manage your linked sign-in providers.
				</p>
			</div>

			<section className="rounded-xl border border-[#1A1D22] bg-[#0A0D12] p-5">
				<div className="flex items-center justify-between gap-3">
					<p className="text-sm font-semibold text-[#DDE2EA]">
						Linked sign-in providers
					</p>
					<Button
						type="button"
						onClick={() => {
							void refreshData();
						}}
						variant="outline"
						className="h-8 border-[#1A1D22] bg-[#0D1118] text-xs text-[#DDE2EA]"
					>
						Refresh
					</Button>
				</div>

				<div className="mt-4 space-y-2">
					{accounts.map((account) => (
						<div
							key={account.id}
							className="flex items-center justify-between rounded-md border border-[#1A1D22] bg-[#0D1118] px-3 py-2"
						>
							<div>
								<p className="text-sm capitalize text-[#DDE2EA]">
									{account.providerId}
								</p>
								<p className="text-[11px] text-[#8A8F99]">
									{account.accountId}
								</p>
							</div>
							{account.providerId !== "credential" && linkedCredential ? (
								<Button
									type="button"
									onClick={() => {
										void unlinkAccount(account.providerId, account.accountId);
									}}
									variant="outline"
									className="h-8 border-[#3A1F26] bg-[#1E1116] text-xs text-[#FFA8B5]"
								>
									Unlink
								</Button>
							) : null}
						</div>
					))}
				</div>

				{!linkedGoogle ? (
					<div className="mt-5 rounded-md border border-[#1A1D22] bg-[#0D1118] p-4">
						<p className="text-sm text-[#DDE2EA]">Link your Google account</p>
						<p className="mt-1 text-xs text-[#8A8F99]">
							Link Google to this existing account.
						</p>
						<Button
							type="button"
							onClick={() => {
								void linkGoogle();
							}}
							disabled={linkingGoogle}
							className="mt-3 h-9 bg-[#C8FF1A] text-xs font-bold text-[#050607] hover:bg-[#d3ff4f]"
						>
							{linkingGoogle ? "Redirecting..." : "Link Google account"}
						</Button>
					</div>
				) : (
					<p className="mt-4 text-xs text-[#C8FF1A]">
						Google is already linked to this account.
					</p>
				)}
			</section>

			{errorMessage ? (
				<p className="rounded-md border border-[#4D2430] bg-[#251116] px-3 py-2 text-xs text-[#FFA8B5]">
					{errorMessage}
				</p>
			) : null}
		</div>
	);
}
