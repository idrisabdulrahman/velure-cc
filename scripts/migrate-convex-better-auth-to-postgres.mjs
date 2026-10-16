#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import pg from "pg";

const archive = process.argv.find((arg) => arg.endsWith(".zip"));
const apply = process.argv.includes("--apply");

if (!archive) {
	throw new Error(
		"Usage: node scripts/migrate-convex-better-auth-to-postgres.mjs <export.zip> [--apply]",
	);
}

function readRows(table) {
	const path = `_components/betterAuth/${table}/documents.jsonl`;
	let text;
	try {
		text = execFileSync("unzip", ["-p", archive, path], { encoding: "utf8" });
	} catch (error) {
		if (error && typeof error === "object" && error.status === 11) return [];
		throw error;
	}
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

function date(value, fallback) {
	if (value == null) return fallback;
	return new Date(typeof value === "number" ? value : String(value));
}

const users = readRows("user");
const accounts = readRows("account");
const sessions = readRows("session");
const verifications = readRows("verification");

console.log(
	JSON.stringify({ users: users.length, accounts: accounts.length, sessions: sessions.length, verifications: verifications.length, mode: apply ? "apply" : "dry-run" }),
);

if (!apply) process.exit(0);

function iso(value, fallback) {
	return date(value, fallback).toISOString();
}

const mapped = {
	users: users.map((row) => ({
		id: row._id,
		name: row.name,
		email: row.email,
		emailVerified: Boolean(row.emailVerified),
		image: row.image ?? null,
		createdAt: iso(row.createdAt, new Date(row._creationTime)),
		updatedAt: iso(row.updatedAt, new Date(row._creationTime)),
	})),
	accounts: accounts.map((row) => ({
		id: row._id,
		accountId: row.accountId,
		providerId: row.providerId,
		userId: row.userId,
		accessToken: row.accessToken ?? null,
		refreshToken: row.refreshToken ?? null,
		idToken: row.idToken ?? null,
		accessTokenExpiresAt: row.accessTokenExpiresAt ? iso(row.accessTokenExpiresAt) : null,
		refreshTokenExpiresAt: row.refreshTokenExpiresAt ? iso(row.refreshTokenExpiresAt) : null,
		scope: row.scope ?? null,
		password: row.password ?? null,
		createdAt: iso(row.createdAt, new Date(row._creationTime)),
		updatedAt: iso(row.updatedAt, new Date(row._creationTime)),
	})),
	sessions: sessions.map((row) => ({
		id: row._id,
		expiresAt: iso(row.expiresAt),
		token: row.token,
		createdAt: iso(row.createdAt, new Date(row._creationTime)),
		updatedAt: iso(row.updatedAt, new Date(row._creationTime)),
		ipAddress: row.ipAddress ?? null,
		userAgent: row.userAgent ?? null,
		userId: row.userId,
	})),
	verifications: verifications.map((row) => ({
		id: row._id,
		identifier: row.identifier,
		value: row.value,
		expiresAt: iso(row.expiresAt),
		createdAt: iso(row.createdAt, new Date(row._creationTime)),
		updatedAt: iso(row.updatedAt, new Date(row._creationTime)),
	})),
};

function jsonSql(rows) {
	return `convert_from(decode('${Buffer.from(JSON.stringify(rows)).toString("base64")}', 'base64'), 'utf8')::jsonb`;
}

async function applyThroughManagementApi(token) {
	const query = `
begin;
insert into better_auth."user"
select * from jsonb_populate_recordset(null::better_auth."user", ${jsonSql(mapped.users)})
on conflict ("id") do update set "name"=excluded."name", "email"=excluded."email", "emailVerified"=excluded."emailVerified", "image"=excluded."image", "updatedAt"=excluded."updatedAt";
insert into better_auth."account"
select * from jsonb_populate_recordset(null::better_auth."account", ${jsonSql(mapped.accounts)})
on conflict ("id") do update set "accountId"=excluded."accountId", "providerId"=excluded."providerId", "userId"=excluded."userId", "accessToken"=excluded."accessToken", "refreshToken"=excluded."refreshToken", "idToken"=excluded."idToken", "accessTokenExpiresAt"=excluded."accessTokenExpiresAt", "refreshTokenExpiresAt"=excluded."refreshTokenExpiresAt", "scope"=excluded."scope", "password"=excluded."password", "updatedAt"=excluded."updatedAt";
insert into better_auth."session"
select * from jsonb_populate_recordset(null::better_auth."session", ${jsonSql(mapped.sessions)})
on conflict ("id") do update set "expiresAt"=excluded."expiresAt", "token"=excluded."token", "updatedAt"=excluded."updatedAt", "ipAddress"=excluded."ipAddress", "userAgent"=excluded."userAgent", "userId"=excluded."userId";
insert into better_auth."verification"
select * from jsonb_populate_recordset(null::better_auth."verification", ${jsonSql(mapped.verifications)})
on conflict ("id") do update set "identifier"=excluded."identifier", "value"=excluded."value", "expiresAt"=excluded."expiresAt", "updatedAt"=excluded."updatedAt";
commit;`;
	const ref = process.env.SUPABASE_PROJECT_REF ?? "kbexydkmmfabfutgkbxn";
	const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
		method: "POST",
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: JSON.stringify({ query }),
	});
	if (!response.ok) throw new Error(`Management SQL failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
	console.log("Better Auth migration committed through Supabase management API.");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	const token = process.env.SUPABASE_MANAGEMENT_TOKEN ?? readFileSync(`${process.env.HOME}/.supabase/access-token`, "utf8").trim();
	await applyThroughManagementApi(token);
	process.exit(0);
}

const pool = new pg.Pool({
	connectionString,
	options: "-c search_path=better_auth",
});
const client = await pool.connect();

try {
	await client.query("begin");
	for (const row of users) {
		await client.query(
			`insert into "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
			 values ($1, $2, $3, $4, $5, $6, $7)
			 on conflict ("id") do update set
			 "name" = excluded."name", "email" = excluded."email",
			 "emailVerified" = excluded."emailVerified", "image" = excluded."image",
			 "updatedAt" = excluded."updatedAt"`,
			[
				row._id,
				row.name,
				row.email,
				Boolean(row.emailVerified),
				row.image ?? null,
				date(row.createdAt, new Date(row._creationTime)),
				date(row.updatedAt, new Date(row._creationTime)),
			],
		);
	}

	for (const row of accounts) {
		await client.query(
			`insert into "account" ("id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt")
			 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
			 on conflict ("id") do update set
			 "accountId"=excluded."accountId", "providerId"=excluded."providerId",
			 "userId"=excluded."userId", "accessToken"=excluded."accessToken",
			 "refreshToken"=excluded."refreshToken", "idToken"=excluded."idToken",
			 "accessTokenExpiresAt"=excluded."accessTokenExpiresAt",
			 "refreshTokenExpiresAt"=excluded."refreshTokenExpiresAt",
			 "scope"=excluded."scope", "password"=excluded."password",
			 "updatedAt"=excluded."updatedAt"`,
			[
				row._id, row.accountId, row.providerId, row.userId,
				row.accessToken ?? null, row.refreshToken ?? null, row.idToken ?? null,
				row.accessTokenExpiresAt ? date(row.accessTokenExpiresAt) : null,
				row.refreshTokenExpiresAt ? date(row.refreshTokenExpiresAt) : null,
				row.scope ?? null, row.password ?? null,
				date(row.createdAt, new Date(row._creationTime)),
				date(row.updatedAt, new Date(row._creationTime)),
			],
		);
	}

	for (const row of sessions) {
		await client.query(
			`insert into "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId")
			 values ($1,$2,$3,$4,$5,$6,$7,$8)
			 on conflict ("id") do update set
			 "expiresAt"=excluded."expiresAt", "token"=excluded."token",
			 "updatedAt"=excluded."updatedAt", "ipAddress"=excluded."ipAddress",
			 "userAgent"=excluded."userAgent", "userId"=excluded."userId"`,
			[
				row._id, date(row.expiresAt), row.token,
				date(row.createdAt, new Date(row._creationTime)),
				date(row.updatedAt, new Date(row._creationTime)),
				row.ipAddress ?? null, row.userAgent ?? null, row.userId,
			],
		);
	}

	for (const row of verifications) {
		await client.query(
			`insert into "verification" ("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt")
			 values ($1,$2,$3,$4,$5,$6)
			 on conflict ("id") do update set
			 "identifier"=excluded."identifier", "value"=excluded."value",
			 "expiresAt"=excluded."expiresAt", "updatedAt"=excluded."updatedAt"`,
			[
				row._id, row.identifier, row.value, date(row.expiresAt),
				date(row.createdAt, new Date(row._creationTime)),
				date(row.updatedAt, new Date(row._creationTime)),
			],
		);
	}

	await client.query("commit");
	console.log("Better Auth migration committed.");
} catch (error) {
	await client.query("rollback");
	throw error;
} finally {
	client.release();
	await pool.end();
}
