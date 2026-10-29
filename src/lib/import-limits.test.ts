import { describe, expect, it } from "vitest";
import { assertImportFileSize, MAX_IMPORT_FILE_BYTES } from "./import-limits";

describe("import file size guard", () => {
	it("accepts a file exactly at the cap", () => {
		expect(() => assertImportFileSize(MAX_IMPORT_FILE_BYTES)).not.toThrow();
		expect(() => assertImportFileSize(0)).not.toThrow();
	});

	it("rejects a file over the cap with an actionable message", () => {
		// The guard has to run before `file.text()`, so the caller must be able
		// to surface a reason rather than a generic failure.
		expect(() => assertImportFileSize(MAX_IMPORT_FILE_BYTES + 1)).toThrow(
			/5 MB or smaller/,
		);
	});
});
