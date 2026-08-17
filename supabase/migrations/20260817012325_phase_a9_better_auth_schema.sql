-- Velure Phase A9: better-auth standalone issuer — Postgres adapter schema.
--
-- The production better-auth issuer (jwt + oidcProvider plugins) stores its
-- own tables in a dedicated `better_auth` schema on velure-cc, separate from
-- the application's `public` schema. This migration creates that schema and
-- the exact tables + indexes better-auth 1.4.9's Kysely adapter generates for
-- the plugins we use (email/password + jwt + oidcProvider). It was produced
-- by compiling better-auth's own `getMigrations()` output for that config
-- (see scripts/bridge-proof/README.md "Production issuer" section for the
-- reproducible generator), schema-qualified to `better_auth`.
--
-- IMPORTANT: better-auth generates quoted camelCase identifiers
-- (`"emailVerified"`, `"createdAt"`, `"userId"`, ...) and Postgres folds
-- unquoted identifiers to lowercase — the columns must be created exactly as
-- better-auth names them, so every identifier here is double-quoted.
--
-- Security posture:
--   * anon / authenticated / service_role are revoked explicitly — the
--     better-auth tables are NOT exposed through PostgREST (the `public`
--     schema is the only exposed search path), and only the issuer's direct
--     Postgres connection (project owner role, search_path pinned to
--     `better_auth`) may touch them;
--   * no RLS policies: the tables are server-side-only by schema isolation;
--   * the issuer connects with search_path pinned to `better_auth` (the
--     production-issuer server forces `-c search_path=better_auth` on its
--     pool) so every better-auth query resolves against this schema and
--     never `public`.
--
-- Table notes (matching better-auth 1.4.9 field definitions):
--   * ids are text (better-auth generated ids), not uuid;
--   * oauthApplication.redirectUrls / metadata and oauthAccessToken.scopes are
--     comma-/JSON-serialized text (better-auth serializes before storing);
--   * createdAt/updatedAt default to CURRENT_TIMESTAMP (now());
--   * every FK is ON DELETE CASCADE, matching better-auth's schema.
--
-- GATE: this is additive (a new schema); it does not touch public tables or
-- the A9 RLS policies. It must be applied BEFORE the production issuer's
-- first boot, and the issuer must run with search_path pinned to better_auth
-- (otherwise better-auth auto-creates its tables in `public`, which we do not
-- want). The OIDC registration on velure-cc follows once the issuer is live
-- at its public URL.

create schema if not exists better_auth;

create table better_auth."user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

create table better_auth."session" (
  "id" text not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references better_auth."user" ("id") on delete cascade
);

create table better_auth."account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references better_auth."user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz not null
);

create table better_auth."verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

create table better_auth."jwks" (
  "id" text not null primary key,
  "publicKey" text not null,
  "privateKey" text not null,
  "createdAt" timestamptz not null,
  "expiresAt" timestamptz
);

create table better_auth."oauthApplication" (
  "id" text not null primary key,
  "name" text not null,
  "icon" text,
  "metadata" text,
  "clientId" text not null unique,
  "clientSecret" text,
  "redirectUrls" text not null,
  "type" text not null,
  "disabled" boolean,
  "userId" text references better_auth."user" ("id") on delete cascade,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create table better_auth."oauthAccessToken" (
  "id" text not null primary key,
  "accessToken" text not null unique,
  "refreshToken" text not null unique,
  "accessTokenExpiresAt" timestamptz not null,
  "refreshTokenExpiresAt" timestamptz not null,
  "clientId" text not null references better_auth."oauthApplication" ("clientId") on delete cascade,
  "userId" text references better_auth."user" ("id") on delete cascade,
  "scopes" text not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create table better_auth."oauthConsent" (
  "id" text not null primary key,
  "clientId" text not null references better_auth."oauthApplication" ("clientId") on delete cascade,
  "userId" text not null references better_auth."user" ("id") on delete cascade,
  "scopes" text not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null,
  "consentGiven" boolean not null
);

create index "session_userId_idx" on better_auth."session" ("userId");
create index "account_userId_idx" on better_auth."account" ("userId");
create index "verification_identifier_idx" on better_auth."verification" ("identifier");
create index "oauthApplication_userId_idx" on better_auth."oauthApplication" ("userId");
create index "oauthAccessToken_clientId_idx" on better_auth."oauthAccessToken" ("clientId");
create index "oauthAccessToken_userId_idx" on better_auth."oauthAccessToken" ("userId");
create index "oauthConsent_clientId_idx" on better_auth."oauthConsent" ("clientId");
create index "oauthConsent_userId_idx" on better_auth."oauthConsent" ("userId");

-- The issuer connects as the project owner (postgres) with search_path pinned
-- to better_auth, so these are the only roles that need access. Explicitly
-- lock the schema down so nothing else can ever read or write it.
revoke all on schema better_auth from anon, authenticated, service_role;
revoke all on all tables in schema better_auth from anon, authenticated, service_role;
