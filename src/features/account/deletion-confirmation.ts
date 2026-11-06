/**
 * The typed confirmation for the account Danger Zone.
 *
 * GitHub's destructive-action dialogs make you type the resource's own name
 * rather than a fixed word such as "DELETE": the value is unique to the
 * account, so a stray paste or muscle-memory cannot complete it. Here the
 * keyword is the workspace's business name.
 *
 * Comparison trims and ignores case, so a name typed with different
 * capitalisation or stray whitespace still confirms. An empty keyword never
 * matches, which keeps the action disabled until the workspace has loaded.
 */
export function canConfirmAccountDeletion(
	input: string,
	keyword: string,
): boolean {
	const expected = keyword.trim();
	if (!expected) return false;
	return input.trim().toLowerCase() === expected.toLowerCase();
}
