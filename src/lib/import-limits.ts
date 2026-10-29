/**
 * Shared cap for user-supplied import files (invoice and client CSV/XLSX).
 *
 * The guard is applied to `File.size` BEFORE the file is read. Reading first is
 * the failure mode this prevents: `file.text()` loads the whole document, the
 * parser then builds a full 2-D grid, and the receiving-grid probe joins that
 * grid into a second string — so a large or hostile file can freeze or exhaust
 * the tab long before the per-row cap inside the import functions applies.
 */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

export function assertImportFileSize(sizeInBytes: number) {
	if (sizeInBytes > MAX_IMPORT_FILE_BYTES) {
		const limit = MAX_IMPORT_FILE_BYTES / (1024 * 1024);
		throw new Error(
			`Import files must be ${limit} MB or smaller. Split the file and import it in parts.`,
		);
	}
}
