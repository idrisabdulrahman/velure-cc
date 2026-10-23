import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "#/features/einvoicing/provider-adapter";
import { sanitizeAuditPayload } from "./audit";

const mocks = vi.hoisted(() => ({
	workspace: { workspaceId: "workspace-a", role: "owner" as string },
	row: null as { encrypted_bundle: string } | null,
	upsert: vi.fn(),
	select: vi.fn(),
	filters: [] as Array<[string, string]>,
}));

vi.mock("./workspaces", () => ({
	getWorkspaceContext: vi.fn(async () => mocks.workspace),
}));
vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: () => ({
		from: () => ({
			upsert: mocks.upsert,
			select: () => {
				mocks.filters = [];
				return {
					eq: (key: string, value: string) => {
						mocks.filters.push([key, value]);
						return {
							eq: (key2: string, value2: string) => {
								mocks.filters.push([key2, value2]);
								return {
									maybeSingle: async () => ({ data: mocks.row, error: null }),
								};
							},
						};
					},
				};
			},
		}),
	}),
}));

import {
	createWorkspaceProviderAdapter,
	saveEInvoiceProviderCredentials,
} from "./einvoice-provider-credentials";

const userClient = {} as never;
const fakeBundle = {
	apiKey: "fake-api-secret-42",
	certificate: "fake-cert-material",
	privateKey: "fake-private-key",
} as const;
const adapter = {} as ProviderAdapter;

describe("e-invoice provider credentials", () => {
	beforeEach(() => {
		mocks.workspace = { workspaceId: "workspace-a", role: "owner" };
		mocks.row = null;
		mocks.filters = [];
		mocks.upsert.mockReset().mockImplementation(async (row) => {
			mocks.row = { encrypted_bundle: row.encrypted_bundle };
			return { error: null };
		});
	});

	it("stores workspace-bound ciphertext and loads secrets only into adapter construction", async () => {
		await saveEInvoiceProviderCredentials(
			userClient,
			"user-a",
			"mock",
			fakeBundle,
		);
		const stored = mocks.row?.encrypted_bundle;
		expect(stored).toBeTruthy();
		expect(stored).not.toContain(fakeBundle.apiKey);
		expect(stored).not.toContain(fakeBundle.certificate);
		expect(stored).not.toContain(fakeBundle.privateKey);

		let adapterCredentials: unknown;
		const result = await createWorkspaceProviderAdapter(
			userClient,
			"user-a",
			"mock",
			(credentials) => {
				adapterCredentials = credentials;
				return adapter;
			},
		);
		expect(result).toBe(adapter);
		expect(adapterCredentials).toEqual(fakeBundle);
		expect(mocks.filters).toEqual([
			["workspace_id", "workspace-a"],
			["provider_key", "mock"],
		]);
	});

	it("fails closed when the active workspace changes before adapter loading", async () => {
		await saveEInvoiceProviderCredentials(
			userClient,
			"user-a",
			"mock",
			fakeBundle,
		);
		mocks.workspace = { workspaceId: "workspace-b", role: "owner" };
		await expect(
			createWorkspaceProviderAdapter(
				userClient,
				"user-a",
				"mock",
				() => adapter,
			),
		).rejects.toThrow("Provider credentials are unavailable.");
	});

	it("does not permit viewers or malformed/oversized credential bundles", async () => {
		mocks.workspace = { workspaceId: "workspace-a", role: "viewer" };
		await expect(
			saveEInvoiceProviderCredentials(userClient, "user-a", "mock", fakeBundle),
		).rejects.toThrow("writable active workspace");
		mocks.workspace = { workspaceId: "workspace-a", role: "owner" };
		await expect(
			saveEInvoiceProviderCredentials(userClient, "user-a", "mock", {
				apiKey: "x".repeat(300_000),
			}),
		).rejects.toThrow("too large");
		await expect(
			saveEInvoiceProviderCredentials(userClient, "user-a", "mock", {
				notASecret: "fake",
			} as never),
		).rejects.toThrow("non-empty supported");
	});

	it("scrubs secret-shaped audit fields and keeps credential migration server-only", () => {
		const audit = sanitizeAuditPayload({
			provider: "mock",
			apiKey: fakeBundle.apiKey,
			certificate: fakeBundle.certificate,
			privateKey: fakeBundle.privateKey,
		});
		const serialized = JSON.stringify(audit);
		for (const secret of Object.values(fakeBundle)) {
			expect(serialized).not.toContain(secret);
		}
		const migration = readFileSync(
			"supabase/migrations/20261025000000_einvoice_h2_provider_credentials.sql",
			"utf8",
		);
		expect(migration).toContain("enable row level security");
		expect(migration).toMatch(/revoke all .* from anon, authenticated/i);
		expect(migration).not.toMatch(/grant .* to authenticated/i);
		expect(migration).toContain("Rollback: drop table");
	});
});
