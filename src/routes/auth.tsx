import {
	createFileRoute,
	Link,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FaGoogle } from "react-icons/fa6";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/auth")({
	component: AuthPage,
});

type Mode = "sign-in" | "sign-up" | "forgot" | "reset";

function appCallbackURL(path: string) {
	if (typeof window === "undefined") return path;
	return new URL(path, window.location.origin).toString();
}

function AuthPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { data: session, isPending: sessionPending } = authClient.useSession();

	const search = useMemo(() => {
		const params = new URLSearchParams(location.search);
		const rawMode = params.get("mode");
		const rawToken = params.get("token");
		return {
			mode: rawMode === "reset" ? rawMode : undefined,
			token: rawToken ?? undefined,
		};
	}, [location.search]);

	const [mode, setMode] = useState<Mode>(
		search.mode === "reset" && search.token ? "reset" : "sign-in",
	);
	const [showEmailOptions, setShowEmailOptions] = useState(
		search.mode === "reset" && Boolean(search.token),
	);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [googleSubmitting, setGoogleSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	useEffect(() => {
		if (search.mode === "reset" && search.token) {
			setMode("reset");
			setShowEmailOptions(true);
		}
	}, [search.mode, search.token]);

	useEffect(() => {
		if (!sessionPending && session?.user) {
			void navigate({ to: "/invoices", replace: true });
		}
	}, [navigate, session?.user, sessionPending]);

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
			if (password !== confirmPassword) return false;
		}
		return true;
	}, [confirmPassword, email, mode, name, password, search.token]);

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
				const result = await authClient.signUp.email({
					name: name.trim(),
					email: email.trim().toLowerCase(),
					password,
					callbackURL: appCallbackURL("/invoices"),
				});

				if (result.error) {
					setErrorMessage(result.error.message ?? "Could not create account.");
					return;
				}
			} else {
				const result = await authClient.signIn.email({
					email: email.trim().toLowerCase(),
					password,
					callbackURL: appCallbackURL("/invoices"),
				});

				if (result.error) {
					setErrorMessage(result.error.message ?? "Invalid login credentials.");
					return;
				}
			}

			if (typeof window !== "undefined") {
				window.location.assign("/invoices");
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

	const onGoogleClick = async () => {
		if (googleSubmitting) return;

		setGoogleSubmitting(true);
		setErrorMessage(null);

		try {
			await authClient.signIn.social({
				provider: "google",
				callbackURL: appCallbackURL("/invoices"),
			});
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "Google sign-in failed. Please try again.",
			);
			setGoogleSubmitting(false);
		}
	};

	const isRecoveryMode = mode === "forgot" || mode === "reset";

	if (sessionPending || session?.user) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-[#040507]">
				<Loader2 className="h-8 w-8 animate-spin text-[#C8FF1A]" />
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-[#040507] text-[#F2F3F5]">
			<div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
				<section className="relative hidden border-r border-[#12151A] lg:flex">
					<div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#1B1F2A_0%,#0A0D12_45%,#050607_100%)]" />
					<div className="absolute inset-0 opacity-[0.18] [background:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.8)_1px,transparent_0)] [background-size:2px_2px]" />
					<div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#050607]/30 to-[#050607]/70" />

					<Link
						to="/"
						className="absolute left-6 top-6 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#1A1D22] bg-[#0B0E14] text-xs font-bold text-[#F2F3F5]"
					>
						V
					</Link>

					<div className="relative z-10 m-auto w-full max-w-[460px] px-12 text-center">
						<p className="font-serif text-4xl leading-tight text-[#F2F3F5]">
							Built for Freelancers who want precision in every invoice.
						</p>
						<p className="mt-5 text-[15px] leading-8 text-[#A0A7B4]">
							From issuing invoices to tracking client payments, Velure keeps
							your billing workflow centralized and consistent.
						</p>
						<p className="mt-6 text-xs tracking-wide text-[#6F7784]">
							Design direction inspired by Midday
						</p>
					</div>
				</section>

				<section className="relative flex min-h-screen items-center justify-center p-6 lg:p-12">
					<div className="w-full max-w-[480px]">
						<div className="mb-7">
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#C8FF1A]">
								Secure access
							</p>
							<p className="font-serif text-[34px] leading-none text-[#F2F3F5]">
								Welcome to Velure
							</p>
							<p className="mt-3 text-sm text-[#8A8F99]">
								{isRecoveryMode
									? "Recover account access securely."
									: "Sign in or create an account."}
							</p>
						</div>

						{!isRecoveryMode && !showEmailOptions ? (
							<div className="space-y-3">
								<button
									type="button"
									onClick={onGoogleClick}
									disabled={googleSubmitting}
									className="relative flex h-12 w-full items-center justify-center border border-[#1A1D22] bg-[#0B0E14] text-sm text-[#F2F3F5] transition-colors hover:border-[#2A351A] hover:bg-[#11161F] disabled:opacity-70"
								>
									<span className="inline-flex items-center justify-center gap-3">
										<FaGoogle className="text-[#F2F3F5]" />
										<span>
											{googleSubmitting
												? "Redirecting..."
												: "Continue with Google"}
										</span>
									</span>
								</button>

								<div className="relative py-4">
									<div className="h-px w-full bg-[#1A1D22]" />
									<span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#040507] px-2 text-xs text-[#7C845D]">
										or
									</span>
								</div>

								<button
									type="button"
									onClick={() => setShowEmailOptions(true)}
									className="h-12 w-full border border-[#1A1D22] bg-[#0B0E14] text-sm text-[#F2F3F5] transition-colors hover:border-[#2A351A] hover:bg-[#11161F]"
								>
									Show email options
								</button>
							</div>
						) : (
							<>
								{mode !== "forgot" && mode !== "reset" ? (
									<div className="mb-5 inline-flex rounded-md border border-[#1A1D22] bg-[#0D1118] p-1 text-xs">
										<button
											type="button"
											onClick={() => setMode("sign-in")}
											className={`rounded px-3 py-1.5 ${mode === "sign-in" ? "bg-[#18240E] text-[#C8FF1A]" : "text-[#8A8F99]"}`}
										>
											Sign in
										</button>
										<button
											type="button"
											onClick={() => setMode("sign-up")}
											className={`rounded px-3 py-1.5 ${mode === "sign-up" ? "bg-[#18240E] text-[#C8FF1A]" : "text-[#8A8F99]"}`}
										>
											Sign up
										</button>
									</div>
								) : null}

								<form onSubmit={onSubmit} className="space-y-3">
									{mode === "sign-up" ? (
										<Input
											value={name}
											onChange={(event) => setName(event.target.value)}
											placeholder="Full name"
											className="h-11 border-[#1A1D22] bg-[#0B0E14] text-[#F2F3F5]"
										/>
									) : null}

									{mode !== "reset" ? (
										<Input
											type="email"
											value={email}
											onChange={(event) => setEmail(event.target.value)}
											placeholder="you@company.com"
											className="h-11 border-[#1A1D22] bg-[#0B0E14] text-[#F2F3F5]"
										/>
									) : null}

									{mode !== "forgot" ? (
										<Input
											type="password"
											value={password}
											onChange={(event) => setPassword(event.target.value)}
											placeholder={
												mode === "reset" ? "New password" : "Password"
											}
											className="h-11 border-[#1A1D22] bg-[#0B0E14] text-[#F2F3F5]"
										/>
									) : null}

									{mode === "sign-up" || mode === "reset" ? (
										<Input
											type="password"
											value={confirmPassword}
											onChange={(event) =>
												setConfirmPassword(event.target.value)
											}
											placeholder={
												mode === "reset"
													? "Confirm new password"
													: "Confirm password"
											}
											className="h-11 border-[#1A1D22] bg-[#0B0E14] text-[#F2F3F5]"
										/>
									) : null}

									{errorMessage ? (
										<p className="rounded-md border border-[#4D2430] bg-[#251116] px-3 py-2 text-xs text-[#FFA8B5]">
											{errorMessage}
										</p>
									) : null}

									{successMessage ? (
										<p className="rounded-md border border-[#2A351A] bg-[#131C0B] px-3 py-2 text-xs text-[#C8FF1A]">
											{successMessage}
										</p>
									) : null}

									<Button
										type="submit"
										disabled={!canSubmit || submitting}
										className="h-11 w-full bg-[#C8FF1A] text-xs font-bold tracking-[0.08em] text-[#050607] hover:bg-[#d3ff4f]"
									>
										{submitting ? (
											<>
												<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
												Working
											</>
										) : mode === "forgot" ? (
											"SEND RESET EMAIL"
										) : mode === "reset" ? (
											"UPDATE PASSWORD"
										) : mode === "sign-up" ? (
											"CREATE ACCOUNT"
										) : (
											"SIGN IN"
										)}
									</Button>

									{mode === "sign-in" ? (
										<button
											type="button"
											onClick={() => {
												setMode("forgot");
												setErrorMessage(null);
												setSuccessMessage(null);
											}}
											className="w-full text-center text-xs text-[#8A8F99] hover:text-[#C8FF1A]"
										>
											Forgot password?
										</button>
									) : null}

									{mode === "forgot" || mode === "reset" ? (
										<button
											type="button"
											onClick={() => {
												setMode("sign-in");
												setErrorMessage(null);
												setSuccessMessage(null);
											}}
											className="w-full text-center text-xs text-[#8A8F99] hover:text-[#C8FF1A]"
										>
											Back to sign in
										</button>
									) : null}
								</form>

								{!isRecoveryMode ? (
									<button
										type="button"
										onClick={() => setShowEmailOptions(false)}
										className="mt-4 text-xs text-[#6F7784] hover:text-[#C8FF1A]"
									>
										Back to provider options
									</button>
								) : null}
							</>
						)}

						<p className="mt-10 text-center text-xs text-[#6F7784]">
							By signing in you agree to our{" "}
							<a
								href="/terms"
								className="underline decoration-[#3F4D22] underline-offset-2 hover:text-[#C8FF1A]"
							>
								Terms
							</a>{" "}
							&{" "}
							<a
								href="/privacy"
								className="underline decoration-[#3F4D22] underline-offset-2 hover:text-[#C8FF1A]"
							>
								Privacy
							</a>
						</p>
					</div>
				</section>
			</div>
		</div>
	);
}
