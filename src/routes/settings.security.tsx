import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Spinner } from "#/components/ui/spinner";
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
				<Spinner size={24} className="text-brand !stroke-brand" />
			</div>
		);
	}

	if (!session?.user) {
		return (
			<div className="rounded-md border border-rule bg-paper-2 p-6 text-sm text-ink-3">
				Sign in to manage security settings.
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-3xl space-y-6">
			<div>
				<h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
					Security
				</h1>
				<p className="mt-2 text-sm text-ink-3">
					Manage the sign-in providers attached to this account.
				</p>
			</div>

			<section className="ui-panel rounded-lg border border-rule bg-paper-2">
				<div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-4">
					<p className="text-sm font-medium text-ink">
						Linked sign-in providers
					</p>
					<Button
						type="button"
						onClick={() => {
							void refreshData();
						}}
						variant="outline"
						className="h-9 rounded-md border-rule bg-transparent text-sm text-ink-2 hover:bg-paper-3"
					>
						Refresh
					</Button>
				</div>

				<div className="space-y-3 px-5 py-5">
					<p className="text-sm leading-6 text-ink-3">
						Velure uses provider records internally to keep password and Google
						sign-in attached to the same account. Users do not need those
						internal identifiers.
					</p>
					{accounts.map((account) => (
						<div
							key={account.id}
							className="flex flex-col gap-3 rounded-md border border-rule bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<div>
								<p className="text-sm font-medium capitalize text-ink">
									{providerLabel(account.providerId)}
								</p>
								<p className="mt-1 max-w-md text-sm leading-6 text-ink-3">
									{providerDescription(account.providerId)}
								</p>
							</div>
							<div className="flex items-center gap-2">
								<span className="inline-flex h-8 items-center rounded-md border border-rule px-3 text-xs font-medium text-ink-3">
									Linked
								</span>
								{account.providerId !== "credential" && linkedCredential ? (
									<Button
										type="button"
										onClick={() => {
											void unlinkAccount(account.providerId, account.accountId);
										}}
										variant="outline"
										className="h-9 rounded-md border-danger-line bg-transparent text-sm text-danger hover:bg-danger-soft"
									>
										Unlink
									</Button>
								) : null}
							</div>
						</div>
					))}

					{accounts.length === 0 ? (
						<div className="flex items-start gap-3 rounded-md border border-rule bg-paper p-4">
							<ShieldCheck className="mt-0.5 h-5 w-5 text-brand" />
							<div>
								<p className="text-sm font-medium text-ink">
									No linked providers yet
								</p>
								<p className="mt-1 text-sm text-ink-3">
									Add Google or keep using your password credential to access
									this workspace.
								</p>
							</div>
						</div>
					) : null}

					{!linkedGoogle ? (
						<div className="rounded-md border border-rule bg-paper p-4">
							<p className="text-sm font-medium text-ink">
								Link your Google account
							</p>
							<p className="mt-1 text-sm text-ink-3">
								Add Google as another way to access this account.
							</p>
							<Button
								type="button"
								onClick={() => {
									void linkGoogle();
								}}
								disabled={linkingGoogle}
								className="mt-4 h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi"
							>
								{linkingGoogle ? "Redirecting..." : "Link Google account"}
							</Button>
						</div>
					) : (
						<p className="text-sm text-brand">
							Google is already linked to this account.
						</p>
					)}
				</div>
			</section>

			{errorMessage ? (
				<p className="rounded-md border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
					{errorMessage}
				</p>
			) : null}
		</div>
	);
}

function providerLabel(providerId: string) {
	if (providerId === "credential") return "Password credential";
	if (providerId === "google") return "Google";
	return providerId;
}

function providerDescription(providerId: string) {
	if (providerId === "credential") {
		return "Email and password sign-in for this account.";
	}
	if (providerId === "google") {
		return "Linked Google account. Google sign-in is available from the sign-in page.";
	}
	return "Linked sign-in method for this account.";
}
