import { beforeAll, describe, expect, it } from "vitest";

let auth: typeof import("./auth").auth;

beforeAll(async () => {
	process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters-long";
	process.env.RESEND_API_KEY = "test-resend-key";
	process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
	auth = (await import("./auth")).auth;
});

describe("in-app Better Auth", () => {
	it("handles auth requests without an external issuer", async () => {
		const response = await auth.handler(
			new Request("http://localhost:3000/api/auth/get-session"),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toBeNull();
	});
});
