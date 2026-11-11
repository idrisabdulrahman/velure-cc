import { createFileRoute } from "@tanstack/react-router";
import { Laptop, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Spinner } from "#/components/ui/spinner";
import { toast } from "#/components/ui/use-toast";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/settings/security")({
	component: SecuritySettingsPage,
});

// Kept in step with `emailAndPassword.minPasswordLength` in `src/lib/auth.ts`
// (and with the same constant on the sign-in screen).
const MIN_PASSWORD_LENGTH = 12;

type AuthAccount = {
	id: string;
	providerId: string;
	accountId: string;
};

type AuthSession = {
	id: string;
	token: string;
	ipAddress?: string | null;
	userAgent?: string | null;
	createdAt: string | Date;
	expiresAt: string | Date;
};

function SecuritySettingsPage() {
	const { data: session, isPending: sessionPending } = authClient.useSession();

	const [accounts, setAccounts] = useState<AuthAccount[]>([]);
	const [sessions, setSessions] = useState<AuthSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [linkingGoogle, setLinkingGoogle] = useState(false);
	const [revokingOthers, setRevokingOthers] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [changingPassword, setChangingPassword] = useState(false);

	const currentSessionToken = session?.session?.token ?? null;

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

		const [accountsResult, sessionsResult] = await Promise.all([
			authClient.listAccounts(),
			authClient.listSessions(),
		]);

		if (accountsResult.error) {
			setErrorMessage(
				accountsResult.error.message ?? "Could not load account data.",
			);
			setLoading(false);
			return;
		}

		setAccounts((accountsResult.data ?? []) as AuthAccount[]);
		if (!sessionsResult.error) {
			setSessions((sessionsResult.data ?? []) as AuthSession[]);
		}
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

	const canChangePassword =
		currentPassword.length > 0 &&
		newPassword.length >= MIN_PASSWORD_LENGTH &&
		newPassword === confirmPassword;

	const submitPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canChangePassword || changingPassword) return;

		setChangingPassword(true);
		try {
			const result = await authClient.changePassword({
				currentPassword,
				newPassword,
				// A password change ends every other session, so a stolen
				// session cannot survive the recovery.
				revokeOtherSessions: true,
			});
			if (result.error) {
				toast({
					title: "Could not change password",
					description: result.error.message ?? "Unknown error",
					variant: "error",
				});
				return;
			}

			toast({
				title: "Password updated",
				description: "Other sessions have been signed out.",
				variant: "success",
			});
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
			await refreshData();
		} finally {
			setChangingPassword(false);
		}
	};

	const signOutOtherSessions = async () => {
		setRevokingOthers(true);
		try {
			const result = await authClient.revokeOtherSessions();
			if (result.error) {
				toast({
					title: "Could not sign out other sessions",
					description: result.error.message ?? "Unknown error",
					variant: "error",
				});
				return;
			}

			toast({
				title: "Other sessions signed out",
				description: "This session stayed active.",
				variant: "success",
			});
			await refreshData();
		} finally {
			setRevokingOthers(false);
		}
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
						Invoicly uses provider records internally to keep password and
						Google sign-in attached to the same account. Users do not need those
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

			<section className="ui-panel rounded-lg border border-rule bg-paper-2">
				<div className="border-b border-rule px-5 py-4">
					<h2 className="text-sm font-medium text-ink">Active sessions</h2>
					<p className="mt-1 text-sm leading-6 text-ink-3">
						Every device signed in to this account. Signing out the others
						leaves this session active.
					</p>
				</div>

				<div className="space-y-3 px-5 py-5">
					{sessions.length === 0 ? (
						<p className="text-sm text-ink-3">No session data is available.</p>
					) : (
						sessions.map((activeSession) => {
							const isCurrent = activeSession.token === currentSessionToken;
							return (
								<div
									key={activeSession.id}
									className="flex flex-col gap-3 rounded-md border border-rule bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="flex items-start gap-3">
										<Laptop className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
										<div className="min-w-0">
											<p className="truncate text-sm font-medium text-ink">
												{describeUserAgent(activeSession.userAgent)}
											</p>
											<p className="mt-1 text-xs text-ink-3">
												{activeSession.ipAddress ?? "Unknown address"} ·{" "}
												{formatSessionDate(activeSession.createdAt)}
											</p>
										</div>
									</div>
									<span
										className={`inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-xs font-medium ${
											isCurrent
												? "border-brand-line bg-brand-soft text-brand"
												: "border-rule text-ink-3"
										}`}
									>
										{isCurrent ? "This session" : "Active"}
									</span>
								</div>
							);
						})
					)}

					<Button
						type="button"
						onClick={() => {
							void signOutOtherSessions();
						}}
						disabled={revokingOthers || sessions.length <= 1}
						variant="outline"
						className="h-10 rounded-md border-rule bg-transparent text-sm font-medium text-ink-2 hover:bg-paper-3"
					>
						{revokingOthers ? "Signing out..." : "Sign out other sessions"}
					</Button>
				</div>
			</section>

			<section className="ui-panel rounded-lg border border-rule bg-paper-2">
				<div className="border-b border-rule px-5 py-4">
					<h2 className="text-sm font-medium text-ink">Change password</h2>
					<p className="mt-1 text-sm leading-6 text-ink-3">
						Use at least {MIN_PASSWORD_LENGTH} characters. Changing it signs out
						every other session.
					</p>
				</div>

				<form className="space-y-4 px-5 py-5" onSubmit={submitPasswordChange}>
					<div className="space-y-1.5">
						<Label htmlFor="security-current-password">Current password</Label>
						<Input
							id="security-current-password"
							type="password"
							autoComplete="current-password"
							value={currentPassword}
							onChange={(event) => setCurrentPassword(event.target.value)}
						/>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="security-new-password">New password</Label>
						<Input
							id="security-new-password"
							type="password"
							autoComplete="new-password"
							value={newPassword}
							onChange={(event) => setNewPassword(event.target.value)}
						/>
						<p className="text-xs text-ink-3">
							{newPassword.length >= MIN_PASSWORD_LENGTH
								? `At least ${MIN_PASSWORD_LENGTH} characters.`
								: `${newPassword.length}/${MIN_PASSWORD_LENGTH} characters so far.`}
						</p>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="security-confirm-password">
							Confirm new password
						</Label>
						<Input
							id="security-confirm-password"
							type="password"
							autoComplete="new-password"
							value={confirmPassword}
							onChange={(event) => setConfirmPassword(event.target.value)}
						/>
						{confirmPassword.length > 0 && confirmPassword !== newPassword ? (
							<p className="text-xs text-danger">
								The passwords do not match yet.
							</p>
						) : null}
					</div>

					<Button
						type="submit"
						disabled={!canChangePassword || changingPassword}
						className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-50"
					>
						{changingPassword ? "Updating..." : "Update password"}
					</Button>
				</form>
			</section>

			{errorMessage ? (
				<p className="rounded-md border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
					{errorMessage}
				</p>
			) : null}
		</div>
	);
}

/** A short, human-readable label for a session's user agent. */
function describeUserAgent(userAgent: string | null | undefined) {
	if (!userAgent) return "Unknown device";
	if (/Playwright|HeadlessChrome|Headless/i.test(userAgent))
		return "Automated browser";
	if (/Edg\//.test(userAgent)) return "Microsoft Edge";
	if (/OPR\/|Opera/.test(userAgent)) return "Opera";
	if (/Firefox\//.test(userAgent)) return "Firefox";
	if (/Chrome\//.test(userAgent)) return "Chrome";
	if (/Safari\//.test(userAgent)) return "Safari";
	return userAgent.slice(0, 60);
}

function formatSessionDate(value: string | Date) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown time";
	return `Started ${date.toLocaleString()}`;
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
