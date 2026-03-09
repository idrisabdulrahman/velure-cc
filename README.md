# Velure

Velure is a dark-first invoice and client billing workspace built with TanStack Start, Nitro, Convex, Better Auth, and Resend. The app supports invoice creation, sharing, PDF generation, email delivery, and Google sign-in.

## Stack

- TanStack Start + Vite + Nitro
- React 19 + TypeScript
- Convex for backend data and Better Auth integration
- Better Auth for email/password and Google OAuth
- Resend for password reset and invoice email delivery

## Local Development

### Prerequisites

- Node.js 20+
- Bun
- A reachable Convex deployment
- Better Auth / Google OAuth credentials if you want to test auth flows
- Resend API key if you want to test email delivery

### Install

```bash
bun install
```

### Start development server

```bash
bun run dev
```

The app runs on `http://localhost:3000`.

## Environment Variables

Copy [`.env.example`](/home/asys/JS-TS/apps/projects/invoice-gen/.env.example) to `.env.local` for local development or configure the same values in your deployment platform.

Required or commonly required values:

- `CONVEX_DEPLOYMENT`: Convex deployment identifier
- `VITE_CONVEX_URL`: Convex HTTP endpoint used by the app
- `VITE_CONVEX_SITE_URL`: Convex site URL used by Better Auth bridge
- `SITE_URL`: public application URL
- `BETTER_AUTH_URL`: public Better Auth base URL for the app
- `BETTER_AUTH_BASE_URL`: optional explicit auth base URL override
- `BETTER_AUTH_SECRET`: Better Auth signing secret
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `RESEND_API_KEY`: Resend API key for email delivery
- `RESEND_FROM`: sender identity for transactional email

Notes:

- `SITE_URL` and `BETTER_AUTH_URL` should point at the same public app domain unless you have a deliberate split setup.
- `VITE_CONVEX_SITE_URL` must be reachable from the deployed app. If it points to an unreachable Convex site, auth will fail.
- Never commit real secrets.

## Production Build and Run

### Build

```bash
bun run build
```

The production build uses a larger Node heap because the Nitro server build can otherwise exhaust memory on this codebase.

### Start production server

```bash
PORT=3000 bun run start
```

The production server:

- serves the Nitro output from `.output`
- binds to `0.0.0.0`
- respects the platform-provided `PORT`

## Sevalla Deployment

This repository is prepared for Dockerfile-based deployment on Sevalla.

### 1. Push the repo

Push the branch containing:

- updated `public/manifest.json`
- `Dockerfile`
- `.dockerignore`
- production `start` script
- updated environment documentation

### 2. Create a new service in Sevalla

- Create a new app/service from your Git repository
- Choose Dockerfile-based deployment
- Let Sevalla build the image from the repository root

### 3. Configure environment variables in Sevalla

At minimum, set:

- `CONVEX_DEPLOYMENT`
- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`
- `SITE_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `NODE_ENV=production`

If you use a distinct Better Auth base URL, also set:

- `BETTER_AUTH_BASE_URL`

### 4. Set the public domain

- Use the generated Sevalla URL or attach your custom domain
- Update `SITE_URL` and `BETTER_AUTH_URL` to that exact HTTPS origin

### 5. Update external providers

#### Google OAuth

In the Google Cloud console, update the authorized redirect URI to the deployed auth callback route, for example:

```text
https://your-domain.com/api/auth/callback/google
```

Do not leave this pointed at `localhost` in production.

#### Better Auth trusted origin behavior

The auth configuration uses the deployed app origin as a trusted origin. If the public app origin changes, redeploy with updated `SITE_URL` / `BETTER_AUTH_URL`.

#### Resend

Make sure `RESEND_FROM` is a sender identity that is valid for your Resend account and production domain policy.

### 6. Deploy

- Trigger the Sevalla deployment
- Confirm the container boots successfully
- Verify logs show the app listening on the platform-provided `PORT`

### 7. Redeploy after env changes

If you change callback URLs, domains, or auth secrets, redeploy so the container uses the updated runtime configuration.

## Post-Deploy Verification Checklist

- The landing page loads on the public Sevalla URL
- `/manifest.json` returns `Velure` branding and dark theme values
- The installed web app shows `Velure` instead of the TanStack starter name
- Email/password sign-in works
- Google sign-in works and returns to the deployed app
- Authenticated users stay signed in when navigating to protected routes
- Invoice list and invoice details pages load
- Invoice preview dialog works
- PDF download works
- Share/email flows work when Resend is configured
- No auth flow or redirect sends users back to `localhost`

## Scripts

- `bun run dev`: start the development server on port 3000
- `bun run build`: create the production build
- `bun run start`: run the built Nitro server
- `bun run test`: run tests
- `bun run check`: run Biome checks

## Temporary Branding Note

The manifest currently reuses the existing icon files in `public/` as temporary placeholders. Replace them with final Velure-branded app icons after deployment is verified.
