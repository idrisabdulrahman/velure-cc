-- Velure Cloudflare hosting (2026-11-03): shared rate-limit store for Better Auth.
-- (prompts/cloudflare-workers-migration.md, "Work package design".)
--
-- Why this table exists. Better Auth's rate limiter defaults to a module-level
-- `Map` per isolate (better-auth/dist/context/create-context.mjs:137). On
-- Cloudflare Workers that map is not shared between isolates, so it cannot gate
-- a login flood. Each password attempt costs one Durable Object request from a
-- shared 100,000/day allowance, so an ungated flood would stop sign-in for
-- everyone. The credentialed auth paths therefore use this table.
--
-- This migration is ADDITIVE and REVERSIBLE. It creates one table, its index,
-- and no row anywhere else. Reversal is `drop table better_auth."rateLimit";`
-- (better-auth falls back to its in-memory store immediately, so no data has to
-- be preserved to roll back).
--
-- Security posture, identical to the Phase A9 better_auth schema:
--   * the table lives in `better_auth`, which is not part of the exposed
--     PostgREST search path, so no API client can reach it;
--   * `anon`, `authenticated` and `service_role` are revoked explicitly;
--   * there is no RLS policy, matching the 8 existing better_auth tables, because
--     schema isolation plus role revocation is the enforcement here;
--   * the rows are deliberately NOT personal data: `key` stores a salted HMAC of
--     `ip + path`, never the address itself, so this is not an IP log;
--   * no workspace or owner identifier is stored, because a rate limit is not
--     tenant data. The tenant key plays no part in this table by design.
--
-- Column notes:
--   * `"key"` is the HMAC hex digest (64 chars), primary key for the lookup;
--   * `"lastRequest"` is epoch milliseconds, which exceeds int4, so it is bigint.
--     The driver returns int8 as a string; src/server/rate-limit-store.ts
--     coerces it back to a number.

create table better_auth."rateLimit" (
  "key" text not null primary key,
  "count" integer not null default 0,
  "lastRequest" bigint not null
);

-- Expired rows are swept opportunistically (`lastRequest < now - 24h`); the
-- index keeps that sweep from scanning the table.
create index "rateLimit_lastRequest_idx"
  on better_auth."rateLimit" ("lastRequest");

-- Belt and braces alongside the A9 schema-level revoke, so this table cannot be
-- reachable by a role that was granted something later.
revoke all on better_auth."rateLimit" from anon, authenticated, service_role;
