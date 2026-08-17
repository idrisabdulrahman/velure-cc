/**
 * Live Supabase acceptance + negative tenancy proof for the identity bridge.
 *
 * Proves, against the real `velure-cc` project:
 *   1. Supabase token acceptance - a real Supabase Auth JWT (issued through
 *      the password flow) is accepted by PostgREST.
 *   2. Claim extraction - the JWT's `sub` is the auth user id, which is what
 *      `app.current_user_id()` reads and what the app stores as owner_id.
 *   3. The A4 helpers in real policies - `app.current_user_id()` and
 *      `app.is_workspace_member()` enforce tenant isolation.
 *   4. Negative tenancy - cross-workspace reads return zero rows, forged
 *      workspace inserts and cross-workspace moves are rejected, and an
 *      unaffiliated user reads zero rows.
 *
 * Everything is scratch and cleaned up in `finally`: the auth users, the two
 * scratch workspaces + memberships, and the scratch RLS table are removed.
 * The real A3 deny-all bootstrap policies on the real tables are untouched.
 *
 * Env: SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY (service role), and
 * SUPABASE_MANAGEMENT_TOKEN (from ~/.supabase/access-token).
 */
import process from "node:process";

const REF = "kbexydkmmfabfutgkbxn";
const API = `https://${REF}.supabase.co`;
const MGMT = "https://api.supabase.com";

const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const mgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
if (!anonKey || !serviceKey || !mgmtToken) {
	throw new Error("Missing SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY / SUPABASE_MANAGEMENT_TOKEN");
}

const PASS = "BridgeProof-2026!";
const suffix = `${Date.now()}`;
const EMAILS = {
	w1: `bridge-w1-${suffix}@gmail.com`,
	w2: `bridge-w2-${suffix}@gmail.com`,
	out: `bridge-out-${suffix}@gmail.com`,
};

let users = {}; // email -> { id, accessToken }
let w1 = null; // scratch workspace ids
let w2 = null;
let scratchTable = null;
let failed = 0;
let passed = 0;

function check(name, ok, detail = "") {
	if (ok) {
		passed += 1;
		console.log(`  ✓ ${name}`);
	} else {
		failed += 1;
		console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

// Retry transient network failures (not HTTP errors). Workspace creation is
// made idempotent by reusing an existing scratch workspace with the same name.
async function mgmtSql(query, attempts = 3) {
	let lastErr;
	for (let i = 0; i < attempts; i += 1) {
		try {
			const res = await fetch(`${MGMT}/v1/projects/${REF}/database/query`, {
				method: "POST",
				headers: { authorization: `Bearer ${mgmtToken}`, "content-type": "application/json" },
				body: JSON.stringify({ query }),
			});
			const text = await res.text();
			if (!res.ok) throw new Error(`mgmt SQL failed: ${res.status} ${text.slice(0, 300)}`);
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		} catch (error) {
			lastErr = error;
			await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
		}
	}
	throw lastErr;
}

function restHeaders(token) {
	return {
		apikey: anonKey,
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
	};
}

// Create the scratch user through the documented admin endpoint (service
// role) with email pre-confirmed, so no confirmation email is sent (signup
// emails are rate-limited). The password flow below still proves real GoTrue
// password verification + JWT issuance.
async function createUser(email) {
	const res = await fetch(`${API}/auth/v1/admin/users`, {
		method: "POST",
		headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
		body: JSON.stringify({ email, password: PASS, email_confirm: true }),
	});
	if (!res.ok) throw new Error(`admin create ${email}: ${res.status} ${await res.text()}`);
	return res.json();
}

async function signIn(email) {
	const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
		method: "POST",
		headers: { apikey: anonKey, "content-type": "application/json" },
		body: JSON.stringify({ email, password: PASS }),
	});
	if (!res.ok) throw new Error(`sign-in ${email}: ${res.status} ${await res.text()}`);
	return res.json();
}

/** REST request; returns { status, body }. */
async function rest(method, path, token, body) {
	const res = await fetch(`${API}/rest/v1/${path}`, {
		method,
		headers: { ...restHeaders(token), prefer: "return=representation" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	let parsed;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	return { status: res.status, body: parsed };
}

async function cleanup() {
	const emailList = Object.values(EMAILS).map((e) => `'${e}'`).join(", ");
	try {
		await mgmtSql(`drop table if exists public._bridge_proof_tenancy;`);
	} catch (error) {
		console.error("cleanup: drop table failed:", error.message);
	}
	if (w1 && w2) {
		try {
			await mgmtSql(`
				delete from public.workspace_members where workspace_id in ('${w1}', '${w2}');
				delete from public.workspaces where id in ('${w1}', '${w2}');
			`);
		} catch (error) {
			console.error("cleanup: workspace rows failed:", error.message);
		}
	}
	try {
		await mgmtSql(`delete from auth.users where email in (${emailList});`);
	} catch (error) {
		console.error("cleanup: auth users failed:", error.message);
	}
}

async function main() {
	// 1. Create + sign in three scratch users via the real password flow.
	console.log("1) Supabase token acceptance (admin create -> password flow -> real JWT)");
	for (const [role, email] of Object.entries(EMAILS)) {
		const created = await createUser(email);
		const session = await signIn(email);
		if (!session.access_token) throw new Error(`no access token for ${email}`);
		const payload = JSON.parse(
			Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"),
		);
		users[role] = { id: created.id, accessToken: session.access_token };
		check(
			`${role} session token claims (sub=${created.id.slice(0, 8)}..., role=${payload.role})`,
			payload.sub === created.id && payload.role === "authenticated" && payload.aud === "authenticated",
			JSON.stringify(payload),
		);
	}

	// 2. Scratch tenancy: two workspaces + memberships + the scratch RLS table.
	console.log("2) Scratch tenancy on the real A4 helpers");
	for (const [key, owner, name] of [
		["w1", users.w1.id, `Bridge W1 ${suffix}`],
		["w2", users.w2.id, `Bridge W2 ${suffix}`],
	]) {
		const existing = await mgmtSql(
			`select id from public.workspaces where name = '${name}' limit 1;`,
		);
		if (existing.length > 0) {
			if (key === "w1") w1 = existing[0].id;
			else w2 = existing[0].id;
			continue;
		}
		const created = await mgmtSql(`
			insert into public.workspaces (owner_id, name, country_code, base_currency, reminders_enabled, tax_rule_set_version)
			values ('${owner}', '${name}', 'NG', 'NGN', false, 'ng-2026-q1')
			returning id;
		`);
		if (key === "w1") w1 = created[0].id;
		else w2 = created[0].id;
	}
	await mgmtSql(`
		insert into public.workspace_members (workspace_id, user_id, role) values
			('${w1}', '${users.w1.id}', 'owner'),
			('${w2}', '${users.w2.id}', 'owner');
	`);

	scratchTable = "_bridge_proof_tenancy";
	await mgmtSql(`
		create table public.${scratchTable} (
			id uuid primary key default gen_random_uuid(),
			workspace_id uuid,
			owner_id text,
			note text
		);
		alter table public.${scratchTable} enable row level security;
		-- Supabase default privileges grant anon full access to new tables;
		-- revoke it to mirror the real migrations' posture.
		revoke all on table public.${scratchTable} from anon, authenticated;
		grant select, insert, update, delete on public.${scratchTable} to authenticated;
		create policy bridge_select on public.${scratchTable}
			for select to authenticated
			using (owner_id = app.current_user_id() or (workspace_id is not null and app.is_workspace_member(workspace_id)));
		create policy bridge_insert on public.${scratchTable}
			for insert to authenticated
			with check (owner_id = app.current_user_id() or (workspace_id is not null and app.is_workspace_member(workspace_id)));
		create policy bridge_update on public.${scratchTable}
			for update to authenticated
			using (owner_id = app.current_user_id() or (workspace_id is not null and app.is_workspace_member(workspace_id)))
			with check (owner_id = app.current_user_id() or (workspace_id is not null and app.is_workspace_member(workspace_id)));
		create policy bridge_delete on public.${scratchTable}
			for delete to authenticated
			using (owner_id = app.current_user_id() or (workspace_id is not null and app.is_workspace_member(workspace_id)));
		notify pgrst, 'reload schema';
	`);

	// PostgREST picks up the schema reload asynchronously; poll until the
	// table is routable (service role, which bypasses RLS but not routing).
	for (let i = 0; i < 16; i += 1) {
		const res = await fetch(`${API}/rest/v1/${scratchTable}?select=id&limit=1`, {
			headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
		});
		if (res.status !== 404) break;
		await new Promise((r) => setTimeout(r, 500));
	}

	// 3. Positive: each workspace member writes and reads only their own rows.
	console.log("3) Positive tenancy (members see and write only their workspace)");
	const w1Insert = await rest("POST", scratchTable, users.w1.accessToken, {
		workspace_id: w1,
		owner_id: null,
		note: "w1 row",
	});
	check("W1 inserts into W1 (201)", w1Insert.status === 201, `status=${w1Insert.status}`);
	const w1RowId = Array.isArray(w1Insert.body) ? w1Insert.body[0]?.id : null;

	const w1Owner = await rest("POST", scratchTable, users.w1.accessToken, {
		workspace_id: null,
		owner_id: users.w1.id,
		note: "w1 owner-scoped",
	});
	check("W1 inserts owner-scoped row (201)", w1Owner.status === 201, `status=${w1Owner.status}`);

	const w2Insert = await rest("POST", scratchTable, users.w2.accessToken, {
		workspace_id: w2,
		owner_id: null,
		note: "w2 row",
	});
	check("W2 inserts into W2 (201)", w2Insert.status === 201, `status=${w2Insert.status}`);
	const w2RowId = Array.isArray(w2Insert.body) ? w2Insert.body[0]?.id : null;

	const w1Read = await rest("GET", `${scratchTable}?select=id,note`, users.w1.accessToken);
	const w1Rows = Array.isArray(w1Read.body) ? w1Read.body : [];
	check(
		"W1 reads only its own rows (2 of 2)",
		w1Rows.length === 2 && w1Rows.every((r) => r.id === w1RowId || r.id === w1Owner.body?.[0]?.id),
		`rows=${w1Rows.length}`,
	);

	const w2Read = await rest("GET", `${scratchTable}?select=id,note`, users.w2.accessToken);
	const w2Rows = Array.isArray(w2Read.body) ? w2Read.body : [];
	check("W2 reads only its own row (1 of 1)", w2Rows.length === 1 && w2Rows[0].id === w2RowId, `rows=${w2Rows.length}`);

	const outRead = await rest("GET", `${scratchTable}?select=id`, users.out.accessToken);
	check("unaffiliated user reads zero rows", Array.isArray(outRead.body) && outRead.body.length === 0, JSON.stringify(outRead.body));

	const w2ReadW1 = await rest("GET", `${scratchTable}?id=eq.${w1RowId}`, users.w2.accessToken);
	check("W2 cannot read W1's row by id (zero rows)", Array.isArray(w2ReadW1.body) && w2ReadW1.body.length === 0, JSON.stringify(w2ReadW1.body));

	// 4. Negatives: forged writes and cross-workspace moves are rejected.
	console.log("4) Negative tenancy (forged writes and moves rejected)");
	const forged = await rest("POST", scratchTable, users.w1.accessToken, {
		workspace_id: w2,
		owner_id: null,
		note: "forged",
	});
	check("W1 inserting into W2 (forged workspace) is rejected", forged.status === 401 || forged.status === 403, `status=${forged.status}`);

	const forgedOwner = await rest("POST", scratchTable, users.w1.accessToken, {
		workspace_id: null,
		owner_id: users.w2.id,
		note: "forged owner",
	});
	check("W1 forging another user's owner_id is rejected", forgedOwner.status === 401 || forgedOwner.status === 403, `status=${forgedOwner.status}`);

	const move = await rest("PATCH", `${scratchTable}?id=eq.${w1RowId}`, users.w1.accessToken, {
		workspace_id: w2,
	});
	check("W1 moving a row into W2 is rejected", move.status === 401 || move.status === 403, `status=${move.status}`);

	const outInsert = await rest("POST", scratchTable, users.out.accessToken, {
		workspace_id: w1,
		owner_id: null,
		note: "outsider",
	});
	check("unaffiliated user insert is rejected", outInsert.status === 401 || outInsert.status === 403, `status=${outInsert.status}`);

	// RLS semantics: an UPDATE on an invisible row is a silent no-op (200, zero
	// rows affected), not an error - the unaffiliated user must never change data.
	const outPatch = await rest("PATCH", `${scratchTable}?id=eq.${w1RowId}`, users.out.accessToken, { note: "hijack" });
	check(
		"unaffiliated user cannot modify W1's row (silent no-op)",
		outPatch.status === 200 && Array.isArray(outPatch.body) && outPatch.body.length === 0,
		`status=${outPatch.status} body=${JSON.stringify(outPatch.body)}`,
	);
	const w1Recheck = await rest("GET", `${scratchTable}?id=eq.${w1RowId}&select=note`, users.w1.accessToken);
	check(
		"W1's row is unchanged after the outsider PATCH",
		Array.isArray(w1Recheck.body) && w1Recheck.body[0]?.note === "w1 row",
		JSON.stringify(w1Recheck.body),
	);

	// 5. Anonymous denial on the scratch table.
	console.log("5) Anonymous denial");
	const anonRes = await fetch(`${API}/rest/v1/${scratchTable}?select=id`, {
		headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
	});
	// anon has no grant on the scratch table: PostgREST returns 404 (table
	// hidden) or 401 (permission denied) - both deny, 200 would leak.
	check("anon read of scratch table denied", anonRes.status === 401 || anonRes.status === 404, `status=${anonRes.status}`);

	// 6. Real-table posture untouched: anonymous on real tenancy tables still denied.
	const realRes = await fetch(`${API}/rest/v1/invoices?select=id&limit=1`, {
		headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
	});
	check("anon read of real invoices still denied", realRes.status === 401, `status=${realRes.status}`);

	console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exitCode = 1;
}

try {
	await main();
} finally {
	await cleanup();
	console.log("cleanup: scratch users, workspaces, memberships, and table removed");
}
