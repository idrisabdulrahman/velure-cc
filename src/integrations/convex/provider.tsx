import { ConvexProvider } from 'convex/react'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import { authClient } from '#/lib/auth-client'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL
const convexQueryClient = CONVEX_URL ? new ConvexQueryClient(CONVEX_URL) : null

export default function AppConvexProvider({
  children,
}: {
  children: React.ReactNode
}) {
  if (!convexQueryClient) {
    console.warn('VITE_CONVEX_URL is missing; rendering without Convex provider')
    return <>{children}</>
  }

  return (
    <ConvexBetterAuthProvider
      client={convexQueryClient.convexClient}
      authClient={authClient}
    >
      <ConvexProvider client={convexQueryClient.convexClient}>
        {children}
      </ConvexProvider>
    </ConvexBetterAuthProvider>
  )
}
