import { createFileRoute } from '@tanstack/react-router'
import {
  getAuthSessionFromRequest,
  sendLinkStepUpOtp,
} from '#/server/security-stepup'

async function handle({ request }: { request: Request }) {
  const session = await getAuthSessionFromRequest(request)

  if (!session?.user) {
    return Response.json(
      { ok: false, error: 'Authentication is required.' },
      { status: 401 },
    )
  }

  if (!session.user.twoFactorEnabled) {
    return Response.json(
      {
        ok: false,
        error:
          'Enable MFA before requesting a step-up challenge for account linking.',
      },
      { status: 403 },
    )
  }

  const authResponse = await sendLinkStepUpOtp(request)

  if (!authResponse.ok) {
    const message = await authResponse.text()
    return Response.json(
      { ok: false, error: message || 'Failed to send security code.' },
      { status: authResponse.status || 400 },
    )
  }

  return Response.json({ ok: true })
}

export const Route = createFileRoute('/api/security/link-stepup/request')({
  server: {
    handlers: {
      POST: handle,
    },
  },
})
