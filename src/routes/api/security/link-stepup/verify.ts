import { createFileRoute } from "@tanstack/react-router";
import {
  buildLinkStepUpCookie,
  getAuthSessionFromRequest,
  signLinkStepUpToken,
  verifyLinkStepUpOtp,
} from "#/server/security-stepup";

async function handle({ request }: { request: Request }) {
  const session = await getAuthSessionFromRequest(request);

  if (!session?.user) {
    return Response.json({ ok: false, error: "Authentication is required." }, { status: 401 });
  }

  let payload: { code?: string };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const code = payload.code?.trim();
  if (!code || code.length < 6) {
    return Response.json(
      { ok: false, error: "A valid 6-digit code is required." },
      { status: 400 },
    );
  }

  const authResponse = await verifyLinkStepUpOtp(request, code);

  if (!authResponse.ok) {
    const message = await authResponse.text();
    return Response.json(
      { ok: false, error: message || "Invalid security code." },
      { status: authResponse.status || 400 },
    );
  }

  const token = await signLinkStepUpToken({
    userId: session.user.id,
    sessionId: session.session.id,
  });

  const setCookie = buildLinkStepUpCookie(request, token);

  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": setCookie,
      },
    },
  );
}

export const Route = createFileRoute("/api/security/link-stepup/verify")({
  server: {
    handlers: {
      POST: handle,
    },
  },
});
