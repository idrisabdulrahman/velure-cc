import { createLazyFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FaGoogle } from "react-icons/fa6";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { authClient } from "#/lib/auth-client";

export const Route = createLazyFileRoute("/auth")({
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
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedPreference = window.localStorage.getItem("velure.remember-me");
    if (savedPreference === "false") {
      setRememberMe(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("velure.remember-me", String(rememberMe));
  }, [rememberMe]);

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
      return Boolean(search.token) && password.length >= 8 && password === confirmPassword;
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
          setErrorMessage(result.error.message ?? "Could not send reset email.");
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
          rememberMe,
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
          rememberMe,
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
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed.");
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
        error instanceof Error ? error.message : "Google sign-in failed. Please try again.",
      );
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
      ? "Create an account to manage invoices and clients."
      : mode === "forgot"
        ? "Enter your email to receive a reset link."
        : mode === "reset"
          ? "Set a new password for your account."
          : "Enter your account details to continue.";

  if (sessionPending || session?.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#111214]">
        <Loader2 className="h-8 w-8 animate-spin text-[#d8b865]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111214] text-[#f0ece4] [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:32px_32px]">
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="ui-panel grid w-full max-w-[980px] overflow-hidden border border-[#2a2d31] bg-[#141516] lg:grid-cols-[0.95fr_1.05fr]">
          <section className="hidden border-r border-[#2a2d31] bg-[linear-gradient(180deg,#181a1d_0%,#141516_100%)] lg:flex lg:flex-col lg:justify-between">
            <div className="p-7">
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-sm font-medium text-[#f0ece4]"
              >
                <span className="h-3 w-3 bg-[#d8b865]" />
                Velure
              </Link>
            </div>

            <div className="px-7 pb-7">
              <h1 className="text-5xl font-semibold tracking-[-0.04em] text-[#f0ece4]">Welcome</h1>
              <p className="mt-5 max-w-sm text-sm leading-7 text-[#a49d91]">
                Velure keeps sign-in direct: dense spacing, clear fields, and a quieter visual
                system that matches the product instead of breaking away from it.
              </p>

              <div className="mt-10 border-t border-[#2a2d31] pt-3">
                <InfoRow label="Environment" value="Private workspace" />
                <InfoRow label="Security" value="Email, password, session lock" />
                <InfoRow label="Status" value="Available" />
              </div>
            </div>
          </section>

          <section className="bg-[#151515] p-6 sm:p-8 lg:p-10">
            <div className="mx-auto max-w-[420px]">
              <div className="mb-8">
                <p className="text-[30px] font-semibold tracking-[-0.03em] text-[#f0ece4]">
                  {pageTitle}
                </p>
                <p className="mt-2 text-sm text-[#9f988d]">{pageDescription}</p>
              </div>

              {!isRecoveryMode && !showEmailOptions ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={onGoogleClick}
                    disabled={googleSubmitting}
                    className="flex h-10 w-full items-center justify-center gap-3 border border-[#2a2d31] bg-[#15181a] text-sm font-medium text-[#f0ece4] transition-[background-color,border-color,color] duration-150 hover:border-[#34382e] hover:bg-[#191d18] disabled:opacity-70"
                  >
                    <FaGoogle className="text-[#f0ece4]" />
                    {googleSubmitting ? "Redirecting..." : "Continue with Google"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowEmailOptions(true)}
                    className="h-10 w-full border border-[#2a2d31] bg-transparent text-sm font-medium text-[#d5d0c7] transition-[background-color,border-color,color] duration-150 hover:border-[#34382e] hover:bg-[#191d18] hover:text-[#ece7de]"
                  >
                    Use email and password
                  </button>
                </div>
              ) : (
                <>
                  {mode !== "forgot" && mode !== "reset" ? (
                    <div className="mb-5 inline-flex border border-[#2a2d31] bg-[#111214] p-1 text-sm">
                      <button
                        type="button"
                        onClick={() => setMode("sign-in")}
                        className={`px-4 py-2 transition-colors duration-150 ${
                          mode === "sign-in"
                            ? "bg-[#1c2118] text-[#d8e0c2]"
                            : "text-[#8e877c] hover:text-[#ece7de]"
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
                            : "text-[#8e877c] hover:text-[#ece7de]"
                        }`}
                      >
                        Sign up
                      </button>
                    </div>
                  ) : null}

                  <form onSubmit={onSubmit} className="space-y-4">
                    {mode === "sign-up" ? (
                      <Field label="Name">
                        <Input
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          placeholder="Jane Doe"
                          className="h-10 border-[#2a2d31] bg-[#16181a] text-[#f0ece4] placeholder:text-[#6f6a62] focus-visible:border-[#4c5435]"
                        />
                      </Field>
                    ) : null}

                    {mode !== "reset" ? (
                      <Field label="Email">
                        <Input
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder="name@domain.com"
                          className="h-10 border-[#2a2d31] bg-[#16181a] text-[#f0ece4] placeholder:text-[#6f6a62] focus-visible:border-[#4c5435]"
                        />
                      </Field>
                    ) : null}

                    {mode !== "forgot" ? (
                      <Field label="Password">
                        <Input
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          placeholder={
                            mode === "reset" ? "Enter a new password" : "Enter your password"
                          }
                          className="h-10 border-[#2a2d31] bg-[#16181a] text-[#f0ece4] placeholder:text-[#6f6a62] focus-visible:border-[#4c5435]"
                        />
                      </Field>
                    ) : null}

                    {mode === "sign-up" || mode === "reset" ? (
                      <Field label="Confirm password">
                        <Input
                          type="password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          placeholder="Confirm your password"
                          className="h-10 border-[#2a2d31] bg-[#16181a] text-[#f0ece4] placeholder:text-[#6f6a62] focus-visible:border-[#4c5435]"
                        />
                      </Field>
                    ) : null}

                    {mode === "sign-in" ? (
                      <div className="flex items-center justify-between gap-3 text-xs text-[#a49d91]">
                        <label className="inline-flex items-center gap-2 text-[#aaa395]">
                          <Checkbox
                            checked={rememberMe}
                            onCheckedChange={(checked) => setRememberMe(checked === true)}
                            className="h-3.5 w-3.5 border-[#3a3d30] bg-[#121416] text-[#121314] data-[state=checked]:border-[#a7bc62] data-[state=checked]:bg-[#a7bc62]"
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
                          className="text-[#a7bc62] transition-colors duration-150 hover:text-[#b5c97a]"
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
                      className="h-10 w-full border border-[#7d8f45] bg-[#a7bc62] text-sm font-semibold text-[#121314] hover:bg-[#b5c97a]"
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

                    {!isRecoveryMode ? (
                      <button
                        type="button"
                        onClick={() => setShowEmailOptions(false)}
                        className="block w-full text-center text-sm text-[#8e877c] transition-colors duration-150 hover:text-[#a7bc62]"
                      >
                        Back to provider options
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setMode("sign-in");
                          setErrorMessage(null);
                          setSuccessMessage(null);
                        }}
                        className="block w-full text-center text-sm text-[#8e877c] transition-colors duration-150 hover:text-[#a7bc62]"
                      >
                        Back to sign in
                      </button>
                    )}
                  </form>
                </>
              )}

              <div className="mt-8 border-t border-[#2a2d31] pt-4 text-xs text-[#8e877c]">
                {mode === "sign-in" ? (
                  <p>
                    Need an account?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setShowEmailOptions(true);
                        setMode("sign-up");
                        setErrorMessage(null);
                        setSuccessMessage(null);
                      }}
                      className="text-[#a7bc62] transition-colors duration-150 hover:text-[#b5c97a]"
                    >
                      Request access
                    </button>
                  </p>
                ) : (
                  <p>
                    By continuing you agree to our{" "}
                    <a
                      href="/terms"
                      className="text-[#a7bc62] transition-colors duration-150 hover:text-[#b5c97a]"
                    >
                      Terms
                    </a>{" "}
                    and{" "}
                    <a
                      href="/privacy"
                      className="text-[#a7bc62] transition-colors duration-150 hover:text-[#b5c97a]"
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-[#c9c2b7]">{label}</span>
      {children}
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-4 border-b border-[#2a2d31] py-4 last:border-b-0">
      <span className="text-xs text-[#8e877c]">{label}</span>
      <span className="text-xs font-medium text-[#f0ece4]">{value}</span>
    </div>
  );
}
