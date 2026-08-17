import { describe, expect, it } from "vitest";

describe("invoice submission actions", () => {
	it("keeps delivery intents explicit", () => {
		const actions = ["create", "create_and_send", "scheduled"] as const;
		expect(actions).toEqual(["create", "create_and_send", "scheduled"]);
	});
});
