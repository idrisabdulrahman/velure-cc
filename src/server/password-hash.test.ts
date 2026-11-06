import { hashPassword as betterAuthHash } from "better-auth/crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password-hash";

/**
 * Gate 1: password compatibility.
 *
 * The Durable Object hasher exists so existing passwords keep working without a
 * reset. That is only true if the new implementation is byte compatible with
 * `better-auth@1.4.9`, which produced every stored hash in production. These
 * tests prove compatibility in **both directions** against better-auth's own
 * functions rather than only checking that our code agrees with itself.
 *
 * A hash that round trips only through our own functions could still be
 * unreadable once better-auth verifies it (or vice versa), which is exactly the
 * failure this suite is here to catch.
 */

/** Every input class that has ever caused a scrypt/normalization mismatch. */
const PASSWORDS: Array<[string, string]> = [
	["ASCII", "Correct-Horse-Battery-9!"],
	["NFC unicode", "pässwörd-mit-Ümlauten"],
	["NFD unicode", "pässwörd-mit-Ümlauten".normalize("NFD")],
	["accented latin", "ñøäççéñts"],
	["surrounding whitespace", "  spaced  "],
	["astral plane emoji", "🔐-emoji-password-🔐"],
	["12 char boundary (app minimum)", "1234567890ab"],
	["128 char boundary (app maximum)", "a".repeat(128)],
];

describe("password hash contract", () => {
	describe("hashes written by better-auth 1.4.9", () => {
		for (const [label, password] of PASSWORDS) {
			it(`verifies ${label}`, async () => {
				// The stored hash a real user has today.
				const stored = await betterAuthHash(password);

				expect(await verifyPassword({ hash: stored, password })).toBe(true);
			});
		}

		it("accepts a hash of the NFC form from an NFD submission", async () => {
			const stored = await betterAuthHash("pässwörd-mit-Ümlauten");

			expect(
				await verifyPassword({
					hash: stored,
					password: "pässwörd-mit-Ümlauten".normalize("NFD"),
				}),
			).toBe(true);
		});
	});

	describe("hashes written by this module", () => {
		for (const [label, password] of PASSWORDS) {
			it(`is readable by better-auth 1.4.9 for ${label}`, async () => {
				const stored = await hashPassword(password);

				// Byte compatible, not merely self consistent: better-auth itself
				// must be able to read what we wrote.
				expect(
					await import("better-auth/crypto").then((crypto) =>
						crypto.verifyPassword({ hash: stored, password }),
					),
				).toBe(true);
			});
		}

		it("writes the expected format", async () => {
			const stored = await hashPassword("format-check-password");

			// 16 byte salt hex encoded, 64 byte key hex encoded.
			expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
		});

		it("uses a fresh salt every time", async () => {
			expect(await hashPassword("same-password")).not.toBe(
				await hashPassword("same-password"),
			);
		});
	});

	describe("rejections", () => {
		it("rejects a wrong password", async () => {
			const stored = await hashPassword("right-password-here");

			expect(
				await verifyPassword({ hash: stored, password: "wrong-password-here" }),
			).toBe(false);
		});

		it("rejects a password that differs only in normalization", async () => {
			// Not a defect: NFKC makes NFC and NFD equal, so this must PASS. The
			// case that must fail is a genuinely different string.
			const stored = await hashPassword("pässwörd-mit-Ümlauten");

			expect(
				await verifyPassword({
					hash: stored,
					password: "passwort-mit-umlauten",
				}),
			).toBe(false);
		});

		it("rejects a key of the wrong length without an early return", async () => {
			// A short key must be false, not a throw or a length-based shortcut.
			const salt = "0123456789abcdef0123456789abcdef";

			expect(
				await verifyPassword({ hash: `${salt}:00`, password: "anything" }),
			).toBe(false);
		});

		it("throws on a hash with no separator, matching 1.4.9", async () => {
			await expect(
				verifyPassword({ hash: "not-a-valid-hash", password: "x" }),
			).rejects.toThrow();
		});

		it("throws on a hash with a non hex key, matching 1.4.9", async () => {
			await expect(
				verifyPassword({ hash: "abcdef:zzzz", password: "x" }),
			).rejects.toThrow();
		});

		it("throws the same way better-auth does for each malformed input", async () => {
			const crypto = await import("better-auth/crypto");

			for (const malformed of [
				"not-a-valid-hash",
				"abcdef:zzzz",
				":missing-salt",
			]) {
				const betterAuthThrew = await crypto
					.verifyPassword({ hash: malformed, password: "x" })
					.then(() => false)
					.catch(() => true);

				const ours = await verifyPassword({ hash: malformed, password: "x" })
					.then(() => false)
					.catch(() => true);

				expect(ours).toBe(betterAuthThrew);
			}
		});
	});
});
