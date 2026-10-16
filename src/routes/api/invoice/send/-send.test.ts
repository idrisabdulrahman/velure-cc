import { describe, expect, it, vi } from "vitest";

vi.mock("#/server/invoice-repository", () => ({}));
vi.mock("#/server/data/payments", () => ({}));
vi.mock("#/server/env", () => ({}));
vi.mock("#/server/pdf", () => ({}));

import { providerErrorMessage } from "./$id";

describe("invoice email errors", () => {
	it("does not expose provider response details", () => {
		expect(
			providerErrorMessage(
				new Error("API key invalid for account buyer@example.com"),
			),
		).toBe("Email could not be sent. Retry or use the share/download options.");
	});
});
