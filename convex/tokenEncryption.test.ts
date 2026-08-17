import { describe, expect, it } from "vitest";
import {
	decryptSensitiveFields,
	decryptToken,
	encryptSensitiveFields,
	encryptToken,
	isEncryptedToken,
} from "./tokenEncryption";

describe("token encryption", () => {
	it("round-trips a token", async () => {
		const encrypted = await encryptToken("sk_live_paystack_secret");
		expect(encrypted).toMatch(
			/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
		);
		const decrypted = await decryptToken(encrypted);
		expect(decrypted).toBe("sk_live_paystack_secret");
	});

	it("produces a fresh IV per call (no deterministic ciphertext)", async () => {
		const a = await encryptToken("same-input");
		const b = await encryptToken("same-input");
		expect(a).not.toBe(b);
		expect(await decryptToken(a)).toBe("same-input");
		expect(await decryptToken(b)).toBe("same-input");
	});

	it("round-trips with workspace isolation", async () => {
		const encrypted = await encryptToken("xero-access-token", "workspace-42");
		const decrypted = await decryptToken(encrypted, "workspace-42");
		expect(decrypted).toBe("xero-access-token");
	});

	it("rejects decryption with wrong workspace", async () => {
		const encrypted = await encryptToken("quickbooks-token", "workspace-a");
		await expect(decryptToken(encrypted, "workspace-b")).rejects.toThrow();
	});

	it("rejects decryption when workspace binding is dropped", async () => {
		const encrypted = await encryptToken("bound-token", "workspace-a");
		await expect(decryptToken(encrypted)).rejects.toThrow();
	});

	it("rejects tampered ciphertext", async () => {
		const encrypted = await encryptToken("secret-token");
		const parts = encrypted.split(":");
		const tampered = `${parts[0]}:${parts[1]}A:${parts[2]}`;
		await expect(decryptToken(tampered)).rejects.toThrow();
	});

	it("rejects invalid encrypted format", async () => {
		await expect(decryptToken("not-encrypted")).rejects.toThrow(
			"Invalid encrypted token format.",
		);
		await expect(decryptToken("a:b:c:d")).rejects.toThrow(
			"Invalid encrypted token format.",
		);
	});
});

describe("isEncryptedToken", () => {
	it("returns true for valid encrypted tokens", async () => {
		const encrypted = await encryptToken("anything");
		expect(isEncryptedToken(encrypted)).toBe(true);
	});

	it("returns false for plaintext", () => {
		expect(isEncryptedToken("sk_live_plain")).toBe(false);
	});

	it("returns false for a colon-shaped plaintext (length check)", () => {
		// Three base64-ish parts, but the decoded IV/authTag lengths are wrong.
		expect(isEncryptedToken("a:b:c")).toBe(false);
	});

	it("returns false for invalid formats", () => {
		expect(isEncryptedToken("a:b")).toBe(false);
		expect(isEncryptedToken("a:b:c:d")).toBe(false);
		expect(isEncryptedToken("")).toBe(false);
		expect(isEncryptedToken(undefined)).toBe(false);
	});
});

describe("sensitive fields helpers", () => {
	it("encrypts and decrypts specified fields", async () => {
		const obj = {
			provider: "quickbooks",
			accessToken: "access-123",
			refreshToken: "refresh-456",
			status: "connected",
		};

		const encrypted = await encryptSensitiveFields(obj, [
			"accessToken",
			"refreshToken",
		]);
		expect(encrypted.accessToken).not.toBe("access-123");
		expect(encrypted.refreshToken).not.toBe("refresh-456");
		expect(encrypted.provider).toBe("quickbooks");
		expect(encrypted.status).toBe("connected");
		expect(isEncryptedToken(encrypted.accessToken)).toBe(true);
		expect(isEncryptedToken(encrypted.refreshToken)).toBe(true);

		const decrypted = await decryptSensitiveFields(encrypted, [
			"accessToken",
			"refreshToken",
		]);
		expect(decrypted.accessToken).toBe("access-123");
		expect(decrypted.refreshToken).toBe("refresh-456");
	});

	it("skips already-encrypted fields", async () => {
		const once = await encryptSensitiveFields({ token: "raw" }, ["token"]);
		const twice = await encryptSensitiveFields(once, ["token"]);
		expect(once.token).toBe(twice.token);
	});

	it("handles undefined or empty string fields", async () => {
		const encrypted = await encryptSensitiveFields(
			{ token: "", noToken: undefined },
			["token", "noToken"],
		);
		expect(encrypted.token).toBe("");
		expect(encrypted.noToken).toBe(undefined);
	});
});
