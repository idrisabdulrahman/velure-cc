import {
	createLazyFileRoute,
	Link,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { Keyboard, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "#/components/theme/theme-toggle";
import { AppLoader } from "#/components/ui/app-loader";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Icons } from "#/components/ui/icons";
import { Input } from "#/components/ui/input";
import { authClient } from "#/lib/auth-client";
import { useWorkspaceActions } from "#/lib/auth-hook";

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

function isNetworkError(error: unknown) {
	if (error instanceof TypeError) {
		const msg = error.message.toLowerCase();
		return (
			msg.includes("failed to fetch") ||
			msg.includes("networkerror") ||
			msg.includes("network request failed") ||
			msg.includes("load failed")
		);
	}
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		if (msg === "httperror" || msg.includes("network") || msg.includes("fetch"))
			return true;
	}
	if (typeof navigator !== "undefined" && !navigator.onLine) return true;
	return false;
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

	if (lastError instanceof Error) throw lastError;
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
	const { ensure: ensureWorkspaceContext } = useWorkspaceActions();

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

	// Caps Lock awareness for the password fields. Chromium draws its own
	// native, unstyled tooltip for `type="password"` (the clipped floating
	// pill) and exposes no page-level way to disable it, so the warning is
	// rendered here instead, in the Wayfare warn tokens.
	// `capsLockOn` and `capsField` are deliberately separate state: a click
	// into a field fires `pointerdown` (which reads Caps Lock) before `blur`
	// and `focus` (which move `capsField`), so a single combined value would
	// be wiped by that event order.
	const [capsLockOn, setCapsLockOn] = useState(false);
	const [capsField, setCapsField] = useState<string | null>(null);

	// `getModifierState` is authoritative on key events; `pointerdown` carries
	// it too, so a field focused with Caps Lock already on shows the warning
	// immediately instead of waiting for the first keystroke.
	const readCapsLock = (
		event:
			| React.KeyboardEvent<HTMLInputElement>
			| React.PointerEvent<HTMLInputElement>,
	) => {
		setCapsLockOn(event.getModifierState("CapsLock"));
	};
	const focusCapsField = (event: React.FocusEvent<HTMLInputElement>) => {
		setCapsField(event.currentTarget.id);
	};
	const blurCapsField = () => {
		setCapsField(null);
	};

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
				isNetworkError(error)
					? "You appear to be offline. Please check your connection and try again."
					: error instanceof Error
						? error.message
						: "Authentication failed.",
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
				isNetworkError(error)
					? "You appear to be offline. Please check your connection and try again."
					: error instanceof Error
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
		// Transient pre-redirect gate, never provisioning: bare spinner.
		return (
			<div className="hm-app flex min-h-screen items-center justify-center bg-paper">
				<AppLoader label={null} />
			</div>
		);
	}

	return (
		<div className="hm-app min-h-screen bg-paper text-ink">
			<div className="fixed right-4 top-4 z-50">
				<ThemeToggle className="fixed right-4 top-4 z-50 h-9 w-9 rounded-md border border-rule bg-paper-2 text-ink-2 hover:bg-paper-3 hover:text-ink" />
			</div>
			<div className="flex min-h-screen items-center justify-center p-6">
				<div className="ui-panel hm-reveal grid w-full max-w-245 overflow-hidden rounded-[var(--hm-r-card)] border border-rule bg-paper lg:grid-cols-[0.95fr_1.05fr]">
					<section className="hidden border-r border-rule bg-paper-2 lg:flex lg:flex-col lg:justify-between">
						<div className="p-7">
							<Link
								to="/"
								className="inline-flex items-center gap-2.5 text-sm font-medium text-ink"
							>
								<span
									className="flex h-7 w-7 items-center justify-center text-[13px] font-extrabold text-brand-ink"
									style={{
										borderRadius: "8px",
										background: "var(--hm-accent)",
										fontFamily: "var(--hm-font-display)",
									}}
									aria-hidden
								>
									V
								</span>
								<span style={{ fontFamily: "var(--hm-font-display)" }}>
									Velure
								</span>
							</Link>
						</div>

						<div className="px-7 pb-7">
							<h1
								className="text-5xl font-extrabold tracking-[-0.032em] text-ink"
								style={{
									fontFamily: "var(--hm-font-display)",
									lineHeight: 1.02,
								}}
							>
								Welcome
							</h1>
							<p className="mt-5 max-w-sm text-sm leading-7 text-ink-3">
								Velure keeps sign-in direct: dense spacing, clear fields, and a
								quieter visual system that matches the product instead of
								breaking away from it.
							</p>

							<div className="mt-10 border-t border-rule pt-5">
								<InfoRow label="Environment" value="Private workspace" />
								<InfoRow
									label="Security"
									value="Email, password, session lock"
								/>
								<InfoRow label="Status" value="Available" />
							</div>
						</div>
					</section>

					<section className="bg-paper p-6 sm:p-8 lg:p-10">
						<div className="mx-auto max-w-[420px]">
							<div className="mb-7">
								<p
									className="hm-label mb-2 text-brand"
									style={{ letterSpacing: "0.005em" }}
								>
									{pageTitle}
								</p>
								<h2
									className="text-[34px] font-extrabold tracking-[-0.028em] text-ink"
									style={{
										fontFamily: "var(--hm-font-display)",
										lineHeight: 1.05,
									}}
								>
									{mode === "sign-up"
										? "Open your workspace"
										: mode === "forgot"
											? "Reset your password"
											: mode === "reset"
												? "Choose a new password"
												: "Sign in to Velure"}
								</h2>
								<p className="mt-2 text-sm leading-6 text-ink-3">
									{pageDescription}
								</p>
							</div>

							{mode !== "forgot" && mode !== "reset" ? (
								<div
									className="mb-5 inline-flex items-center gap-1 rounded-full border border-rule bg-paper-2 p-1 text-sm"
									role="tablist"
									aria-label="Authentication mode"
								>
									<button
										type="button"
										role="tab"
										aria-selected={mode === "sign-in"}
										onClick={() => setMode("sign-in")}
										className={`rounded-full px-4 py-1.5 transition-colors duration-150 ${
											mode === "sign-in"
												? "bg-brand text-brand-ink shadow-(--hm-shadow-soft)"
												: "text-ink-3 hover:text-ink"
										}`}
									>
										Sign in
									</button>
									<button
										type="button"
										role="tab"
										aria-selected={mode === "sign-up"}
										onClick={() => setMode("sign-up")}
										className={`rounded-full px-4 py-1.5 transition-colors duration-150 ${
											mode === "sign-up"
												? "bg-brand text-brand-ink shadow-(--hm-shadow-soft)"
												: "text-ink-3 hover:text-ink"
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
										className="hm-btn hm-btn--ghost h-11 w-full"
									>
										{googleSubmitting ? (
											<>
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Opening Google
											</>
										) : (
											<>
												<Icons.Google className="mr-2 h-4 w-4" />
												Continue with Google
											</>
										)}
									</Button>
									<p className="text-xs leading-5 text-ink-3">
										Google sign-in only works after you link Google from
										Security.
									</p>
									<div
										className="hm-label flex items-center gap-3 text-ink-3"
										style={{ letterSpacing: "0.005em" }}
									>
										<span className="h-px flex-1 bg-rule" />
										<span>Email sign-in</span>
										<span className="h-px flex-1 bg-rule" />
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
											className="h-10 rounded-(--hm-r-input) border-rule bg-paper-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-line"
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
											className="h-10 rounded-[var(--hm-r-input)] border-rule bg-paper-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-line"
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
											className="h-10 rounded-[var(--hm-r-input)] border-rule bg-paper-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-line"
										/>
									</Field>
								) : null}

								{mode !== "forgot" ? (
									<Field
										label="Password"
										htmlFor="password"
										hint={
											<CapsLockBadge
												active={capsLockOn && capsField === "password"}
											/>
										}
									>
										<Input
											id="password"
											type="password"
											value={password}
											onChange={(event) => setPassword(event.target.value)}
											onKeyDown={readCapsLock}
											onKeyUp={readCapsLock}
											onPointerDown={readCapsLock}
											onFocus={focusCapsField}
											onBlur={blurCapsField}
											placeholder={
												mode === "reset"
													? "Enter a new password"
													: "Enter your password"
											}
											className="h-10 rounded-[var(--hm-r-input)] border-rule bg-paper-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-line"
										/>
									</Field>
								) : null}

								{mode === "sign-up" || mode === "reset" ? (
									<Field
										label="Confirm password"
										htmlFor="confirmPassword"
										hint={
											<CapsLockBadge
												active={capsLockOn && capsField === "confirmPassword"}
											/>
										}
									>
										<Input
											id="confirmPassword"
											type="password"
											value={confirmPassword}
											onChange={(event) =>
												setConfirmPassword(event.target.value)
											}
											onKeyDown={readCapsLock}
											onKeyUp={readCapsLock}
											onPointerDown={readCapsLock}
											onFocus={focusCapsField}
											onBlur={blurCapsField}
											placeholder="Confirm your password"
											className="h-10 rounded-[var(--hm-r-input)] border-rule bg-paper-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-line"
										/>
									</Field>
								) : null}

								{mode === "sign-in" ? (
									<div className="flex items-center justify-between gap-3 text-xs text-ink-3">
										<label
											htmlFor="rememberMe"
											className="inline-flex items-center gap-2 text-ink-3"
										>
											<Checkbox
												id="rememberMe"
												checked={rememberMe}
												onCheckedChange={(checked) =>
													setRememberMe(checked === true)
												}
												className="h-3.5 w-3.5 border-brand-line bg-paper text-brand-ink data-[state=checked]:border-brand data-[state=checked]:bg-brand"
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
											className="text-brand-hi underline-offset-2 transition-colors duration-150 hover:underline"
										>
											Forgot password?
										</button>
									</div>
								) : null}

								{errorMessage ? (
									<p className="rounded-[var(--hm-r-input)] border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
										{errorMessage}
									</p>
								) : null}

								{successMessage ? (
									<p className="rounded-[var(--hm-r-input)] border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
										{successMessage}
									</p>
								) : null}

								<Button
									type="submit"
									disabled={!canSubmit || submitting}
									className="hm-btn hm-btn--primary h-11 w-full"
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
										className="block w-full text-center text-sm text-ink-3 transition-colors duration-150 hover:text-brand"
									>
										Back to sign in
									</button>
								) : null}
							</form>

							<div className="mt-8 border-t border-rule pt-5 text-xs text-ink-3">
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
											className="text-brand-hi underline-offset-2 transition-colors duration-150 hover:underline"
										>
											Request access
										</button>
									</p>
								) : (
									<p>
										By continuing you agree to our{" "}
										<a
											href="/terms"
											className="text-brand-hi underline-offset-2 transition-colors duration-150 hover:underline"
										>
											Terms
										</a>{" "}
										and{" "}
										<a
											href="/privacy"
											className="text-brand-hi underline-offset-2 transition-colors duration-150 hover:underline"
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

// Rendered in the Field label row (never inside the <label>, which would
// fold it into the input's accessible name). `leading-none` keeps the pill
// within the text-sm line height so the row does not shift on mount.
function CapsLockBadge({ active }: { active: boolean }) {
	if (!active) return null;
	return (
		<span
			role="status"
			className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-warn-line bg-warn-soft px-2 py-0.5 text-[11px] font-medium leading-none text-warn"
		>
			<Keyboard className="size-3.5" aria-hidden="true" />
			Caps Lock is on
		</span>
	);
}

function Field({
	label,
	htmlFor,
	children,
	hint,
}: {
	label: string;
	htmlFor?: string;
	children: React.ReactNode;
	hint?: React.ReactNode;
}) {
	return (
		<div className="block">
			<div className="mb-2 flex items-center justify-between gap-3">
				<label htmlFor={htmlFor} className="text-sm text-ink-2">
					{label}
				</label>
				{hint}
			</div>
			{children}
		</div>
	);
}

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid grid-cols-[64px_1fr] gap-4 border-b border-rule py-4 last:border-b-0">
			<span className="text-xs text-ink-3">{label}</span>
			<span className="text-xs font-medium text-ink">{value}</span>
		</div>
	);
}
