import {
	createLazyFileRoute,
	Link,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { authClient } from "#/lib/auth-client";
import { api } from "../../convex/_generated/api";

export const Route = createLazyFileRoute("/auth")({
	component: AuthPage,
});

type Mode = "sign-in" | "sign-up" | "forgot" | "reset";
const pendingBusinessNameKey = "velure.pending-business-name";
const authSubmitRetryDelaysMs = [350, 900, 1800] as const;

type AuthResultWithError = {
	error?: unknown;
};

const wait = (delayMs: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, delayMs);
	});

function authErrorField(
	error: unknown,
	field: "message" | "status" | "statusCode" | "code",
) {
	if (!error || typeof error !== "object") return undefined;
	return (error as Record<string, unknown>)[field];
}

function authErrorMessage(error: unknown, fallback: string) {
	const message = authErrorField(error, "message");
	return typeof message === "string" && message.trim() ? message : fallback;
}

function authErrorStatus(error: unknown) {
	const status =
		authErrorField(error, "status") ??
		authErrorField(error, "statusCode") ??
		authErrorField(error, "code");
	if (typeof status === "number") return status;
	if (typeof status !== "string") return undefined;

	const numericStatus = Number.parseInt(status, 10);
	return Number.isFinite(numericStatus) ? numericStatus : undefined;
}

function isUserActionAuthError(error: unknown) {
	const code = authErrorField(error, "code");
	if (typeof code !== "string") return false;

	const normalizedCode = code.toUpperCase();
	return (
		normalizedCode.includes("INVALID_CREDENTIAL") ||
		normalizedCode.includes("INVALID_EMAIL") ||
		normalizedCode.includes("INVALID_PASSWORD") ||
		normalizedCode.includes("USER_ALREADY_EXISTS") ||
		normalizedCode.includes("USER_NOT_FOUND")
	);
}

function isRetryableAuthError(error: unknown) {
	if (isUserActionAuthError(error)) return false;

	const status = authErrorStatus(error);
	return (
		status === undefined || status === 408 || status === 429 || status >= 500
	);
}

async function retryAuthSubmit<T extends AuthResultWithError>(
	action: () => Promise<T>,
) {
	let lastError: unknown;

	for (
		let attempt = 0;
		attempt <= authSubmitRetryDelaysMs.length;
		attempt += 1
	) {
		try {
			const result = await action();

			if (!result.error || !isRetryableAuthError(result.error)) {
				return result;
			}

			lastError = result.error;
		} catch (error) {
			lastError = error;
		}

		const retryDelayMs = authSubmitRetryDelaysMs[attempt];
		if (retryDelayMs !== undefined) {
			await wait(retryDelayMs);
		}
	}

	throw new Error(
		authErrorMessage(lastError, "The auth service is temporarily unavailable."),
	);
}

function searchStringValue(search: unknown, key: string) {
	if (typeof search === "string") {
		return new URLSearchParams(search).get(key);
	}

	if (!search || typeof search !== "object") return null;
	const value = (search as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}

function appCallbackURL(path: string) {
	if (typeof window === "undefined") return path;
	return new URL(path, window.location.origin).toString();
}

function authRedirectPath(rawRedirect: string | null) {
	const redirect = rawRedirect?.trim();
	if (!redirect) return "/invoices";
	if (!redirect.startsWith("/") || redirect.startsWith("//"))
		return "/invoices";
	if (redirect.startsWith("/auth") || redirect.startsWith("/api/auth")) {
		return "/invoices";
	}
	return redirect;
}

function AuthPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const ensureWorkspaceContext = useMutation(
		api.account.ensureWorkspaceContext,
	);

	const search = useMemo(() => {
		const rawMode = searchStringValue(location.search, "mode");
		const rawToken = searchStringValue(location.search, "token");
		const rawGoogle = searchStringValue(location.search, "google");
		return {
			mode: rawMode === "reset" ? rawMode : undefined,
			token: rawToken ?? undefined,
			google: rawGoogle ?? undefined,
			redirectTo: authRedirectPath(
				searchStringValue(location.search, "redirect"),
			),
		};
	}, [location.search]);

	const [mode, setMode] = useState<Mode>(
		search.mode === "reset" && search.token ? "reset" : "sign-in",
	);
	const [name, setName] = useState("");
	const [businessName, setBusinessName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [rememberMe, setRememberMe] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [googleSubmitting, setGoogleSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		setHydrated(true);
	}, []);

	useEffect(() => {
		if (!hydrated) return;
		if (typeof window === "undefined") return;

		const savedPreference = window.localStorage.getItem("velure.remember-me");
		if (savedPreference === "false") {
			setRememberMe(false);
		}
	}, [hydrated]);

	useEffect(() => {
		if (!hydrated) return;
		if (typeof window === "undefined") return;
		window.localStorage.setItem("velure.remember-me", String(rememberMe));
	}, [hydrated, rememberMe]);

	useEffect(() => {
		if (search.mode === "reset" && search.token) {
			setMode("reset");
		}
	}, [search.mode, search.token]);

	useEffect(() => {
		if (search.google === "failed") {
			setErrorMessage(
				"Google sign-in is only available after you link Google from Security.",
			);
		}
	}, [search.google]);

	useEffect(() => {
		if (!sessionPending && session?.user) {
			if (typeof window !== "undefined") {
				window.location.replace(search.redirectTo);
				return;
			}
			void navigate({ to: "/invoices", replace: true });
		}
	}, [navigate, search.redirectTo, session?.user, sessionPending]);

	const canSubmit = useMemo(() => {
		if (mode === "forgot") return /^\S+@\S+\.\S+$/.test(email.trim());
		if (mode === "reset") {
			return (
				Boolean(search.token) &&
				password.length >= 8 &&
				password === confirmPassword
			);
		}
		if (!/^\S+@\S+\.\S+$/.test(email.trim())) return false;
		if (password.length < 8) return false;
		if (mode === "sign-up") {
			if (name.trim().length < 2) return false;
			if (businessName.trim().length < 2) return false;
			if (password !== confirmPassword) return false;
		}
		return true;
	}, [
		businessName,
		confirmPassword,
		email,
		mode,
		name,
		password,
		search.token,
	]);

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canSubmit || submitting) return;

		setSubmitting(true);
		setErrorMessage(null);
		setSuccessMessage(null);

		try {
			if (mode === "forgot") {
				const result = await authClient.requestPasswordReset({
					email: email.trim().toLowerCase(),
					redirectTo: "/auth",
				});

				if (result.error) {
					setErrorMessage(
						result.error.message ?? "Could not send reset email.",
					);
					return;
				}

				setSuccessMessage("Password reset email sent. Check your inbox.");
				return;
			}

			if (mode === "reset") {
				const token = search.token;
				if (!token) {
					setErrorMessage("Missing reset token. Request a new reset email.");
					return;
				}

				const result = await authClient.resetPassword({
					token,
					newPassword: password,
				});

				if (result.error) {
					setErrorMessage(result.error.message ?? "Could not reset password.");
					return;
				}

				setSuccessMessage("Password updated. You can sign in now.");
				setMode("sign-in");
				setPassword("");
				setConfirmPassword("");
				return;
			}

			if (mode === "sign-up") {
				const signUpPayload = {
					name: name.trim(),
					email: email.trim().toLowerCase(),
					password,
					callbackURL: appCallbackURL(search.redirectTo),
					businessName: businessName.trim(),
				} as Parameters<typeof authClient.signUp.email>[0] & {
					businessName: string;
				};

				const result = await retryAuthSubmit(() =>
					authClient.signUp.email(signUpPayload),
				);

				if (result.error) {
					setErrorMessage(result.error.message ?? "Could not create account.");
					return;
				}
			} else {
				const result = await retryAuthSubmit(() =>
					authClient.signIn.email({
						email: email.trim().toLowerCase(),
						password,
						callbackURL: appCallbackURL(search.redirectTo),
						rememberMe,
					}),
				);

				if (result.error) {
					setErrorMessage(result.error.message ?? "Invalid login credentials.");
					return;
				}
			}

			const requestedBusinessName =
				mode === "sign-up" ? businessName.trim() || undefined : undefined;
			if (typeof window !== "undefined" && requestedBusinessName) {
				window.sessionStorage.setItem(
					pendingBusinessNameKey,
					requestedBusinessName,
				);
			}

			try {
				await ensureWorkspaceContext({
					businessName: requestedBusinessName,
				});
				if (typeof window !== "undefined" && requestedBusinessName) {
					window.sessionStorage.removeItem(pendingBusinessNameKey);
				}
			} catch {
				// The dashboard repeats this bootstrap after the auth bridge catches up.
			}

			if (typeof window !== "undefined") {
				window.location.assign(search.redirectTo);
				return;
			}

			await navigate({ to: "/invoices", replace: true });
		} catch (error) {
			setErrorMessage(
				error instanceof Error ? error.message : "Authentication failed.",
			);
		} finally {
			setSubmitting(false);
		}
	};

	const onGoogleSignIn = async () => {
		if (googleSubmitting || mode !== "sign-in") return;

		setGoogleSubmitting(true);
		setErrorMessage(null);
		setSuccessMessage(null);

		try {
			const result = await authClient.signIn.social({
				provider: "google",
				callbackURL: appCallbackURL(search.redirectTo),
				errorCallbackURL: appCallbackURL("/auth?google=failed"),
				requestSignUp: false,
			});

			if (result.error) {
				setErrorMessage(
					result.error.message ??
						"Google sign-in is only available after linking Google in Security.",
				);
			}
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "Could not start Google sign-in.",
			);
		} finally {
			setGoogleSubmitting(false);
		}
	};

	const isRecoveryMode = mode === "forgot" || mode === "reset";
	const pageTitle =
		mode === "sign-up"
			? "Create account"
			: mode === "forgot"
				? "Reset password"
				: mode === "reset"
					? "Choose a new password"
					: "Sign in";
	const pageDescription =
		mode === "sign-up"
			? "Create an account and set up your business workspace."
			: mode === "forgot"
				? "Enter your email to receive a reset link."
				: mode === "reset"
					? "Set a new password for your account."
					: "Enter your account details to continue.";

	if (!hydrated || sessionPending || session?.user) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-[#0f1111]">
				<Loader2 className="h-8 w-8 animate-spin text-[#d8b865]" />
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-[#0f1111] text-[#f2efe7] [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:32px_32px]">
			<div className="flex min-h-screen items-center justify-center p-6">
				<div className="ui-panel grid w-full max-w-[980px] overflow-hidden border border-[#2a2d31] bg-[#141715] lg:grid-cols-[0.95fr_1.05fr]">
					<section className="hidden border-r border-[#2a2d31] bg-[linear-gradient(180deg,#181a1d_0%,#141715_100%)] lg:flex lg:flex-col lg:justify-between">
						<div className="p-7">
							<Link
								to="/"
								className="inline-flex items-center gap-2 text-sm font-medium text-[#f2efe7]"
							>
								<span className="h-3 w-3 bg-[#d8b865]" />
								Velure
							</Link>
						</div>

						<div className="px-7 pb-7">
							<h1 className="text-5xl font-semibold tracking-[-0.04em] text-[#f2efe7]">
								Welcome
							</h1>
							<p className="mt-5 max-w-sm text-sm leading-7 text-[#aaa294]">
								Velure keeps sign-in direct: dense spacing, clear fields, and a
								quieter visual system that matches the product instead of
								breaking away from it.
							</p>

							<div className="mt-10 border-t border-[#2a2d31] pt-3">
								<InfoRow label="Environment" value="Private workspace" />
								<InfoRow
									label="Security"
									value="Email, password, session lock"
								/>
								<InfoRow label="Status" value="Available" />
							</div>
						</div>
					</section>

					<section className="bg-[#121514] p-6 sm:p-8 lg:p-10">
						<div className="mx-auto max-w-[420px]">
							<div className="mb-8">
								<p className="text-[30px] font-semibold tracking-[-0.03em] text-[#f2efe7]">
									{pageTitle}
								</p>
								<p className="mt-2 text-sm text-[#9f988d]">{pageDescription}</p>
							</div>

							{mode !== "forgot" && mode !== "reset" ? (
								<div className="mb-5 inline-flex border border-[#2a2d31] bg-[#0f1111] p-1 text-sm">
									<button
										type="button"
										onClick={() => setMode("sign-in")}
										className={`px-4 py-2 transition-colors duration-150 ${
											mode === "sign-in"
												? "bg-[#1c2118] text-[#d8e0c2]"
												: "text-[#8e877c] hover:text-[#f2efe7]"
										}`}
									>
										Sign in
									</button>
									<button
										type="button"
										onClick={() => setMode("sign-up")}
										className={`px-4 py-2 transition-colors duration-150 ${
											mode === "sign-up"
												? "bg-[#1c2118] text-[#d8e0c2]"
												: "text-[#8e877c] hover:text-[#f2efe7]"
										}`}
									>
										Sign up
									</button>
								</div>
							) : null}

							{mode === "sign-in" ? (
								<div className="mb-5 space-y-2">
									<Button
										type="button"
										variant="outline"
										onClick={() => {
											void onGoogleSignIn();
										}}
										disabled={googleSubmitting || submitting}
										className="h-10 w-full rounded-none border-[#2a2d31] bg-[#151817] text-sm font-semibold text-[#f2efe7] hover:border-[#3f5130] hover:bg-[#1c2118]"
									>
										{googleSubmitting ? (
											<>
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Opening Google
											</>
										) : (
											"Continue with Google"
										)}
									</Button>
									<p className="text-xs leading-5 text-[#8e877c]">
										Google sign-in only works after you link Google from
										Security.
									</p>
									<div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-[#6f6a62]">
										<span className="h-px flex-1 bg-[#2a2d31]" />
										<span>Email sign-in</span>
										<span className="h-px flex-1 bg-[#2a2d31]" />
									</div>
								</div>
							) : null}

							<form onSubmit={onSubmit} className="space-y-4">
								{mode === "sign-up" ? (
									<Field label="Name" htmlFor="name">
										<Input
											id="name"
											value={name}
											onChange={(event) => setName(event.target.value)}
											placeholder="Jane Doe"
											className="h-10 border-[#2a2d31] bg-[#151817] text-[#f2efe7] placeholder:text-[#6f6a62] focus-visible:border-[#4c5435]"
										/>
									</Field>
								) : null}

								{mode === "sign-up" ? (
									<Field label="Business name" htmlFor="businessName">
										<Input
											id="businessName"
											value={businessName}
											onChange={(event) => setBusinessName(event.target.value)}
											placeholder="Acme Ventures Ltd"
											className="h-10 border-[#2a2d31] bg-[#151817] text-[#f2efe7] placeholder:text-[#6f6a62] focus-visible:border-[#4c5435]"
										/>
									</Field>
								) : null}

								{mode !== "reset" ? (
									<Field label="Email" htmlFor="email">
										<Input
											id="email"
											type="email"
											value={email}
											onChange={(event) => setEmail(event.target.value)}
											placeholder="name@domain.com"
											className="h-10 border-[#2a2d31] bg-[#151817] text-[#f2efe7] placeholder:text-[#6f6a62] focus-visible:border-[#4c5435]"
										/>
									</Field>
								) : null}

								{mode !== "forgot" ? (
									<Field label="Password" htmlFor="password">
										<Input
											id="password"
											type="password"
											value={password}
											onChange={(event) => setPassword(event.target.value)}
											placeholder={
												mode === "reset"
													? "Enter a new password"
													: "Enter your password"
											}
											className="h-10 border-[#2a2d31] bg-[#151817] text-[#f2efe7] placeholder:text-[#6f6a62] focus-visible:border-[#4c5435]"
										/>
									</Field>
								) : null}

								{mode === "sign-up" || mode === "reset" ? (
									<Field label="Confirm password" htmlFor="confirmPassword">
										<Input
											id="confirmPassword"
											type="password"
											value={confirmPassword}
											onChange={(event) =>
												setConfirmPassword(event.target.value)
											}
											placeholder="Confirm your password"
											className="h-10 border-[#2a2d31] bg-[#151817] text-[#f2efe7] placeholder:text-[#6f6a62] focus-visible:border-[#4c5435]"
										/>
									</Field>
								) : null}

								{mode === "sign-in" ? (
									<div className="flex items-center justify-between gap-3 text-xs text-[#aaa294]">
										<label
											htmlFor="rememberMe"
											className="inline-flex items-center gap-2 text-[#aaa395]"
										>
											<Checkbox
												id="rememberMe"
												checked={rememberMe}
												onCheckedChange={(checked) =>
													setRememberMe(checked === true)
												}
												className="h-3.5 w-3.5 border-[#3f5130] bg-[#121416] text-[#0f1111] data-[state=checked]:border-[#c8ff62] data-[state=checked]:bg-[#c8ff62]"
											/>
											Keep me signed in
										</label>
										<button
											type="button"
											onClick={() => {
												setMode("forgot");
												setErrorMessage(null);
												setSuccessMessage(null);
											}}
											className="text-[#c8ff62] transition-colors duration-150 hover:text-[#d5ff7a]"
										>
											Forgot password?
										</button>
									</div>
								) : null}

								{errorMessage ? (
									<p className="border border-[#5a4141] bg-[#241919] px-3 py-2 text-sm text-[#f0c0c0]">
										{errorMessage}
									</p>
								) : null}

								{successMessage ? (
									<p className="border border-[#6b613f] bg-[#231f14] px-3 py-2 text-sm text-[#e3c97d]">
										{successMessage}
									</p>
								) : null}

								<Button
									type="submit"
									disabled={!canSubmit || submitting}
									className="h-10 w-full border border-[#c8ff62] bg-[#c8ff62] text-sm font-semibold text-[#0f1111] hover:bg-[#d5ff7a]"
								>
									{submitting ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											Working
										</>
									) : mode === "forgot" ? (
										"Send reset email"
									) : mode === "reset" ? (
										"Update password"
									) : mode === "sign-up" ? (
										"Create account"
									) : (
										"Log in"
									)}
								</Button>

								{isRecoveryMode ? (
									<button
										type="button"
										onClick={() => {
											setMode("sign-in");
											setErrorMessage(null);
											setSuccessMessage(null);
										}}
										className="block w-full text-center text-sm text-[#8e877c] transition-colors duration-150 hover:text-[#c8ff62]"
									>
										Back to sign in
									</button>
								) : null}
							</form>

							<div className="mt-8 border-t border-[#2a2d31] pt-4 text-xs text-[#8e877c]">
								{mode === "sign-in" ? (
									<p>
										Need an account?{" "}
										<button
											type="button"
											onClick={() => {
												setMode("sign-up");
												setErrorMessage(null);
												setSuccessMessage(null);
											}}
											className="text-[#c8ff62] transition-colors duration-150 hover:text-[#d5ff7a]"
										>
											Request access
										</button>
									</p>
								) : (
									<p>
										By continuing you agree to our{" "}
										<a
											href="/terms"
											className="text-[#c8ff62] transition-colors duration-150 hover:text-[#d5ff7a]"
										>
											Terms
										</a>{" "}
										and{" "}
										<a
											href="/privacy"
											className="text-[#c8ff62] transition-colors duration-150 hover:text-[#d5ff7a]"
										>
											Privacy
										</a>
										.
									</p>
								)}
							</div>
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor?: string;
	children: React.ReactNode;
}) {
	return (
		<label htmlFor={htmlFor} className="block">
			<span className="mb-2 block text-sm text-[#c9c2b7]">{label}</span>
			{children}
		</label>
	);
}

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid grid-cols-[64px_1fr] gap-4 border-b border-[#2a2d31] py-4 last:border-b-0">
			<span className="text-xs text-[#8e877c]">{label}</span>
			<span className="text-xs font-medium text-[#f2efe7]">{value}</span>
		</div>
	);
}
