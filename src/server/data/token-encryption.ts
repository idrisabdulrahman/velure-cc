/**
 * Token encryption utility for securing sensitive integration tokens at rest.
 *
 * Implemented with the Web Crypto API (`crypto.subtle`) rather than `node:crypto`
 * because these helpers run inside Convex queries/mutations, which execute in
 * Convex's default V8 runtime. That runtime does NOT provide `node:crypto`
 * (`scryptSync`, `createCipheriv`, `timingSafeEqual`, ...) — only Web Crypto.
 * See https://docs.convex.dev/functions/runtimes.
 *
 * Uses AES-256-GCM. The optional workspace/owner identifier is bound as GCM
 * additional authenticated data (AAD), so ciphertext encrypted for one owner
 * cannot be decrypted under another owner's identifier. Security against a
 * database-at-rest compromise comes from INTEGRATION_ENCRYPTION_KEY (a 64-char
 * hex string = 32 random bytes) never being stored alongside the ciphertext.
 */

const IV_LENGTH = 12; // 96-bit nonce, the value recommended for AES-GCM.
const AUTH_TAG_LENGTH = 16; // 128-bit GCM authentication tag.
const KEY_LENGTH = 32; // 256-bit AES key.
const AAD_PREFIX = "velure-integration-tokens";

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
	// TextEncoder returns Uint8Array<ArrayBufferLike>, which no longer satisfies
	// the BufferSource that crypto.subtle expects under TS 5.7+. Copy into a
	// fresh ArrayBuffer-backed view.
	const encoded = new TextEncoder().encode(value);
	const bytes = new Uint8Array(encoded.length);
	bytes.set(encoded);
	return bytes;
}

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * Resolves the 32-byte master key. A fixed, well-known fallback is permitted
 * ONLY under the automated test runtime — development and production must supply
 * a real key. This prevents a misconfigured deploy (where NODE_ENV defaults to
 * "development") from silently "encrypting" every token under a public constant.
 */
function masterKeyBytes(): Uint8Array<ArrayBuffer> {
	const encryptionKey = process.env.INTEGRATION_ENCRYPTION_KEY;
	if (!encryptionKey) {
		if (process.env.NODE_ENV === "test") {
			return new Uint8Array(KEY_LENGTH); // Deterministic all-zero key for tests only.
		}
		throw new Error(
			"INTEGRATION_ENCRYPTION_KEY is required for token encryption. " +
				"Generate one with: openssl rand -hex 32",
		);
	}

	const keyBytes = hexToBytes(encryptionKey);
	if (keyBytes.length !== KEY_LENGTH) {
		throw new Error(
			`INTEGRATION_ENCRYPTION_KEY must be exactly ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes).`,
		);
	}
	return keyBytes;
}

async function importKey(): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		masterKeyBytes(),
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);
}

function additionalData(workspaceId?: string): Uint8Array<ArrayBuffer> {
	return utf8Bytes(workspaceId ? `${AAD_PREFIX}-${workspaceId}` : AAD_PREFIX);
}

/**
 * Encrypts a sensitive token string.
 *
 * @param plaintext - The token to encrypt.
 * @param workspaceId - Optional identifier bound as GCM AAD (must match on decrypt).
 * @returns Encrypted token as `base64(iv):base64(ciphertext):base64(authTag)`.
 */
export async function encryptToken(
	plaintext: string,
	workspaceId?: string,
): Promise<string> {
	const key = await importKey();
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

	const combined = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv,
				additionalData: additionalData(workspaceId),
				tagLength: AUTH_TAG_LENGTH * 8,
			},
			key,
			utf8Bytes(plaintext),
		),
	);

	// Web Crypto appends the auth tag to the ciphertext; split it back out so the
	// stored format stays iv:ciphertext:authTag.
	const ciphertext = combined.slice(0, combined.length - AUTH_TAG_LENGTH);
	const authTag = combined.slice(combined.length - AUTH_TAG_LENGTH);

	return `${toBase64(iv)}:${toBase64(ciphertext)}:${toBase64(authTag)}`;
}

/**
 * Decrypts an encrypted token string.
 *
 * @param encrypted - Encrypted token (`base64(iv):base64(ciphertext):base64(authTag)`).
 * @param workspaceId - Optional identifier (must match the one used to encrypt).
 * @returns The decrypted token string.
 * @throws If decryption fails (tampering, wrong key, or wrong identifier).
 */
export async function decryptToken(
	encrypted: string,
	workspaceId?: string,
): Promise<string> {
	const parts = encrypted.split(":");
	if (parts.length !== 3) {
		throw new Error("Invalid encrypted token format.");
	}

	const iv = fromBase64(parts[0]);
	const ciphertext = fromBase64(parts[1]);
	const authTag = fromBase64(parts[2]);

	if (iv.length !== IV_LENGTH) throw new Error("Invalid IV length.");
	if (authTag.length !== AUTH_TAG_LENGTH) {
		throw new Error("Invalid auth tag length.");
	}

	const combined = new Uint8Array(ciphertext.length + authTag.length);
	combined.set(ciphertext, 0);
	combined.set(authTag, ciphertext.length);

	const key = await importKey();
	const decrypted = await crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv,
			additionalData: additionalData(workspaceId),
			tagLength: AUTH_TAG_LENGTH * 8,
		},
		key,
		combined,
	);

	return new TextDecoder().decode(decrypted);
}

/**
 * Checks whether a string is one of our encrypted tokens.
 *
 * Validates the three-part base64 shape AND that the decoded IV and auth tag
 * have their exact fixed lengths — a plaintext value such as "a:b:c" fails the
 * length check, avoiding the false positives a naive base64 parse produces.
 */
export function isEncryptedToken(value?: string): boolean {
	if (!value) return false;

	const parts = value.split(":");
	if (parts.length !== 3) return false;

	const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
	if (!parts.every((part) => part.length > 0 && base64Pattern.test(part))) {
		return false;
	}

	try {
		const iv = fromBase64(parts[0]);
		const authTag = fromBase64(parts[2]);
		return iv.length === IV_LENGTH && authTag.length === AUTH_TAG_LENGTH;
	} catch {
		return false;
	}
}

/**
 * Encrypts the named fields of an object, skipping values that are already
 * encrypted, empty, or non-string. Useful before storing in the database.
 */
export async function encryptSensitiveFields<T extends Record<string, any>>(
	obj: T,
	fields: readonly (keyof T)[],
	workspaceId?: string,
): Promise<T> {
	const result = { ...obj };
	for (const field of fields) {
		const value = result[field];
		if (typeof value === "string" && value && !isEncryptedToken(value)) {
			result[field] = (await encryptToken(value, workspaceId)) as T[keyof T];
		}
	}
	return result;
}

/**
 * Decrypts the named fields of an object, skipping values that are not
 * encrypted. Useful after retrieving from the database.
 */
export async function decryptSensitiveFields<T extends Record<string, any>>(
	obj: T,
	fields: readonly (keyof T)[],
	workspaceId?: string,
): Promise<T> {
	const result = { ...obj };
	for (const field of fields) {
		const value = result[field];
		if (typeof value === "string" && isEncryptedToken(value)) {
			result[field] = (await decryptToken(value, workspaceId)) as T[keyof T];
		}
	}
	return result;
}
