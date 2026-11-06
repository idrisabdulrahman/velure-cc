import { randomBytes, scrypt as scryptCallback } from "node:crypto";

/**
 * The password hashing contract, preserved byte for byte from
 * `better-auth@1.4.9` (`dist/crypto/password.mjs`).
 *
 * Existing credentials were produced by that implementation, so every detail
 * below is load bearing. The contract was proven against better-auth's own
 * `hashPassword` / `verifyPassword` with 25 cases covering ASCII, NFC and NFD
 * Unicode, whitespace, and astral plane emoji (see
 * `prompts/cloudflare-workers-migration.md`, Gate 1). Three details are the
 * ones a reimplementation gets wrong:
 *
 *   1. The salt is 16 random bytes hex encoded to a 32 character string, and
 *      that **hex string itself** is passed to scrypt. Decoding it back to raw
 *      bytes derives a different key and rejects every existing password.
 *   2. The password is normalized to **NFKC** (not NFC) before hashing, so a
 *      password submitted in decomposed form still verifies.
 *   3. Verification compares the hex decoded key in **constant time**, and a
 *      malformed stored hash throws rather than returning false.
 *
 * Only `node:crypto` is used. `scrypt` is part of Workers' full `node:crypto`
 * support, and `nodejs_compat` is on by default for compatibility dates from
 * 2026-08-04 (ours is 2026-11-02), so this runs unchanged on Node, on the VPS,
 * and inside the Durable Object.
 */

const N = 16384;
const R = 16;
const P = 1;
const DK_LEN = 64;

/**
 * scrypt needs `128 * N * r` bytes (32 MiB at these parameters), which the Node
 * default `maxmem` only just covers. better-auth passes twice that, so we do too.
 */
const MAX_MEM = 128 * N * R * 2;

const HEX_PATTERN = /^[0-9a-fA-F]+$/;

function toHex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("hex");
}

/**
 * Decodes a hex string the way `@noble/hashes` does (which is what better-auth
 * uses), including its failure modes: odd length or a non hex character throws.
 * Matching the throw keeps "malformed hash" behaviour identical.
 */
function fromHex(hex: string): Uint8Array {
	if (hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
		throw new RangeError("Invalid hex string in stored password hash");
	}

	return new Uint8Array(Buffer.from(hex, "hex"));
}

/**
 * Compare two byte arrays in constant time, mirroring better-auth's
 * `constantTimeEqual`: the length difference is folded into the result instead
 * of short circuiting, so a wrong password cannot be distinguished by timing.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	let mismatch = a.length ^ b.length;
	const length = Math.max(a.length, b.length);

	for (let index = 0; index < length; index++) {
		mismatch |=
			(index < a.length ? a[index] : 0) ^ (index < b.length ? b[index] : 0);
	}

	return mismatch === 0;
}

async function deriveKey(password: string, salt: string): Promise<Uint8Array> {
	return await new Promise<Uint8Array>((resolve, reject) => {
		scryptCallback(
			password.normalize("NFKC"),
			// The hex string, not its bytes. See note 1 above.
			salt,
			DK_LEN,
			{ N, r: R, p: P, maxmem: MAX_MEM },
			(error, derived) => {
				if (error) reject(error);
				else resolve(new Uint8Array(derived));
			},
		);
	});
}

/**
 * Hashes a password into `${hexSalt(32)}:${hexKey(128)}`, the exact stored
 * format better-auth writes.
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = toHex(randomBytes(16));
	const key = await deriveKey(password, salt);

	return `${salt}:${toHex(key)}`;
}

/**
 * Verifies a password against a stored hash. Throws on a malformed hash, as
 * better-auth does, instead of silently returning false.
 */
export async function verifyPassword({
	hash,
	password,
}: {
	hash: string;
	password: string;
}): Promise<boolean> {
	const [salt, key] = hash.split(":");
	if (!salt || !key) throw new Error("Invalid password hash");

	return constantTimeEqual(await deriveKey(password, salt), fromHex(key));
}
