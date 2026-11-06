import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { InvoiclySymbol } from "#/components/brand/invoicly-symbol";
import { ThemeToggle } from "#/components/theme/theme-toggle";
import { AppLoader } from "#/components/ui/app-loader";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Spinner } from "#/components/ui/spinner";
import { authClient } from "#/lib/auth-client";
import { authRedirectPath, verificationCallbackURL } from "#/lib/auth-redirect";

/**
 * Landing page for an emailed verification link.
 *
 * Better Auth's own `/api/auth/verify-email` GET verifies the token, optionally
 * creates the session (`autoSignInAfterVerification`) and redirects here. It
 * appends `&error=<code>` to this URL when the token is invalid or expired, so
 * both outcomes are rendered from the same place.
 *
 * The page works signed out too: an expired link with no session still needs a
 * way to request a fresh one, and the resend endpoint answers identically for
 * unknown addresses, so it leaks no account existence.
 */

function searchStringValue(search: unknown, key: string) {
	if (typeof search === "string") {
		return new URLSearchParams(search).get(key);
	}

	if (!search || typeof search !== "object") return null;
	const value = (search as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}

export const Route = createFileRoute("/verify-email")({
	component: VerifyEmailPage,
});

function VerifyEmailPage() {
	const location = useLocation();
	const { data: session, isPending } = authClient.useSession();
	const [email, setEmail] = useState("");
	const [resending, setResending] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const errorCode = searchStringValue(location.search, "error");
	const nextPath = authRedirectPath(searchStringValue(location.search, "next"));
	const verified = session?.user?.emailVerified === true;
	const sessionEmail = session?.user?.email ?? "";

	useEffect(() => {
		if (sessionEmail && !email) setEmail(sessionEmail);
	}, [email, sessionEmail]);

	useEffect(() => {
		if (!verified) return;
		const timer = window.setTimeout(() => {
			window.location.replace(nextPath);
		}, 1500);
		return () => window.clearTimeout(timer);
	}, [nextPath, verified]);

	const onResend = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const target = email.trim().toLowerCase();
		if (!target || resending) return;

		setResending(true);
		setErrorMessage(null);
		setSuccessMessage(null);

		try {
			const result = await authClient.sendVerificationEmail({
				email: target,
				callbackURL: verificationCallbackURL(nextPath),
			});

			if (result.error) {
				setErrorMessage(
					result.error.message ??
						"Could not send a verification email. Try again in a moment.",
				);
				return;
			}

			setSuccessMessage(
				"If that address has a Invoicly account, a new verification link is on its way.",
			);
		} catch {
			setErrorMessage(
				"Could not send a verification email. Check your connection and try again.",
			);
		} finally {
			setResending(false);
		}
	};

	return (
		<div className="hm-app flex min-h-dvh flex-col bg-paper text-ink">
			<div className="flex items-center justify-between p-5">
				<Link
					to="/"
					className="inline-flex items-center gap-2.5 text-sm font-medium text-ink"
				>
					<InvoiclySymbol className="h-7 w-auto" />
					<span style={{ fontFamily: "var(--hm-font-display)" }}>Invoicly</span>
				</Link>
				<ThemeToggle className="h-9 w-9 rounded-md border border-rule bg-paper-2 text-ink-2 hover:bg-paper-3 hover:text-ink" />
			</div>

			<main className="flex flex-1 items-center justify-center px-5 pb-10">
				<div className="ui-panel w-full max-w-md rounded-[var(--hm-r-card)] border border-rule bg-paper p-6 sm:p-8">
					{isPending ? (
						<AppLoader label={null} />
					) : verified ? (
						<div className="space-y-4">
							<p
								className="hm-label text-brand"
								style={{ letterSpacing: "0.005em" }}
							>
								Email verified
							</p>
							<h1
								className="text-[30px] font-extrabold tracking-[-0.028em] text-ink"
								style={{
									fontFamily: "var(--hm-font-display)",
									lineHeight: 1.06,
								}}
							>
								You&apos;re all set
							</h1>
							<p role="status" className="text-sm leading-6 text-ink-3">
								{sessionEmail
									? `${sessionEmail} is confirmed. Taking you to your workspace…`
									: "Your email address is confirmed. Taking you to your workspace…"}
							</p>
							<a
								href={nextPath}
								className="hm-btn hm-btn--primary inline-flex h-11 w-full items-center justify-center"
							>
								Continue
							</a>
						</div>
					) : (
						<div className="space-y-4">
							<p
								className="hm-label text-brand"
								style={{ letterSpacing: "0.005em" }}
							>
								Email verification
							</p>
							<h1
								className="text-[30px] font-extrabold tracking-[-0.028em] text-ink"
								style={{
									fontFamily: "var(--hm-font-display)",
									lineHeight: 1.06,
								}}
							>
								{errorCode
									? "That link is no longer valid"
									: "Verify your email"}
							</h1>
							<p className="text-sm leading-6 text-ink-3">
								{errorCode
									? "The link has expired or was already used. Request a fresh one and open it in this browser."
									: "Open the verification link we emailed you, or request a new one below."}
							</p>

							<form onSubmit={onResend} className="space-y-3">
								<label
									htmlFor="verification-email"
									className="block text-sm text-ink-2"
								>
									Email address
								</label>
								<Input
									id="verification-email"
									type="email"
									autoComplete="email"
									required
									value={email}
									onChange={(event) => setEmail(event.target.value)}
									placeholder="name@domain.com"
									className="h-10 rounded-[var(--hm-r-input)] border-rule bg-paper-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-line"
								/>

								{errorMessage ? (
									<p
										role="alert"
										className="rounded-[var(--hm-r-input)] border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger"
									>
										{errorMessage}
									</p>
								) : null}

								{successMessage ? (
									<p
										role="status"
										className="rounded-[var(--hm-r-input)] border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn"
									>
										{successMessage}
									</p>
								) : null}

								<Button
									type="submit"
									disabled={resending}
									className="hm-btn hm-btn--primary h-11 w-full"
								>
									{resending ? (
										<>
											<Spinner size={16} className="mr-2" />
											Sending
										</>
									) : (
										"Send verification email"
									)}
								</Button>
							</form>

							<Link
								to="/auth"
								className="block text-center text-sm text-ink-3 transition-colors duration-150 hover:text-brand"
							>
								Back to sign in
							</Link>
						</div>
					)}
				</div>
			</main>
		</div>
	);
}
