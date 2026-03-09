import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'

const convexUrl = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL
const convexSiteUrl =
  process.env.VITE_CONVEX_SITE_URL ?? process.env.CONVEX_SITE_URL

if (!convexUrl || !convexSiteUrl) {
  throw new Error(
    'Missing Convex auth env. Set VITE_CONVEX_URL and VITE_CONVEX_SITE_URL.',
  )
}

export const auth = convexBetterAuthReactStart({
  convexUrl,
  convexSiteUrl,
})
