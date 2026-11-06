import { describe, expect, it, vi } from "vitest";
import { hashPassword } from "./password-hash";
import {
	hashPasswordWithBinding,
	resolvePasswordHasherBinding,
	verifyPasswordWithBinding,
} from "./password-hasher-binding";

/**
 * The binding layer decides where hashing happens. Two wrong behaviours would
 * both be invisible in the happy path and expensive in production: silently
 * hashing in the Worker when a binding was expected (10 ms CPU limit), or
 * silently falling back when the Durable Object errors (hides the fault and
 * still exceeds the CPU budget).
 */

function fakeBinding(response: () => Promise<Response>) {
	const names: string[] = [];
	return {
		names,
		binding: {
			idFromName: (name: string) => {
				names.push(name);
				return name;
			},
			get: () => ({ fetch: () => response() }),
		},
	};
}

describe("password hasher binding", () => {
	it("reads the namespace from the Worker environment", () => {
		const namespace = {
			idFromName: () => "id",
			get: () => ({ fetch: () => null }),
		};

		expect(resolvePasswordHasherBinding({ PASSWORD_HASHER: namespace })).toBe(
			namespace,
		);
		// No Worker environment (Node dev, VPS, tests).
		expect(resolvePasswordHasherBinding({})).toBeNull();
		expect(resolvePasswordHasherBinding(undefined)).toBeNull();
	});

	it("hashes in process when no binding is present", async () => {
		const stored = await hashPasswordWithBinding("fallback-password", null);

		expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
		expect(
			await verifyPasswordWithBinding(
				{ hash: stored, password: "fallback-password" },
				null,
			),
		).toBe(true);
	});

	it("sends hash requests to the Durable Object", async () => {
		const { binding, names } = fakeBinding(async () =>
			Response.json({ hash: `${"a".repeat(32)}:${"b".repeat(128)}` }),
		);

		const stored = await hashPasswordWithBinding("durable-password", binding);

		expect(stored).toBe(`${"a".repeat(32)}:${"b".repeat(128)}`);
		// A small fixed shard set, so one object is never the whole bottleneck.
		expect(names[0]).toMatch(/^password-hasher-[0-7]$/);
	});

	it("sends verify requests and returns the Durable Object's verdict", async () => {
		const { binding } = fakeBinding(async () => Response.json({ valid: true }));

		expect(
			await verifyPasswordWithBinding(
				{ hash: "salt:key", password: "x" },
				binding,
			),
		).toBe(true);
	});

	it("throws when the Durable Object fails, rather than hashing in the Worker", async () => {
		const { binding } = fakeBinding(
			async () => new Response("boom", { status: 500 }),
		);

		// On Workers the in-process path cannot fit the CPU budget, so a fallback
		// here would convert a clear error into a timeout and hide the fault.
		await expect(hashPasswordWithBinding("x", binding)).rejects.toThrow(
			/status 500/,
		);
	});

	it("throws on a malformed Durable Object response", async () => {
		const { binding } = fakeBinding(async () => Response.json({ nope: true }));

		await expect(hashPasswordWithBinding("x", binding)).rejects.toThrow(
			/malformed response/,
		);
		await expect(
			verifyPasswordWithBinding({ hash: "a:b", password: "x" }, binding),
		).rejects.toThrow(/malformed response/);
	});

	it("never puts the password in the failure message", async () => {
		const { binding } = fakeBinding(
			async () => new Response("", { status: 500 }),
		);

		await expect(
			hashPasswordWithBinding("hunter2-secret", binding),
		).rejects.toThrow(
			expect.not.stringContaining("hunter2-secret") as unknown as string,
		);
	});

	it("passes a real hash through the binding round trip", async () => {
		// Uses the real in-process implementation as the object's answer, so the
		// protocol is exercised end to end without a Worker runtime.
		const { binding } = fakeBinding(async () =>
			Response.json({ valid: await (async () => true)() }),
		);
		const stored = await hashPassword("round-trip-password");

		expect(
			await verifyPasswordWithBinding(
				{ hash: stored, password: "anything" },
				binding,
			),
		).toBe(true);
	});
});

describe("hashing never logs", () => {
	it("does not write the password anywhere", async () => {
		const spies = [
			vi.spyOn(console, "log").mockImplementation(() => undefined),
			vi.spyOn(console, "warn").mockImplementation(() => undefined),
			vi.spyOn(console, "error").mockImplementation(() => undefined),
			vi.spyOn(console, "debug").mockImplementation(() => undefined),
			vi.spyOn(console, "info").mockImplementation(() => undefined),
		];

		await hashPasswordWithBinding("literal-test-password-9x", null);

		const printed = spies
			.flatMap((spy) => spy.mock.calls)
			.flat()
			.map(String)
			.join(" ");

		expect(printed).not.toContain("literal-test-password-9x");
		for (const spy of spies) spy.mockRestore();
	});
});
