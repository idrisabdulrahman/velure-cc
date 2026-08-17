import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const typesPath = join(root, "src/types/database.types.ts");
const args = [
	"exec",
	"supabase",
	"gen",
	"types",
	"typescript",
	"--linked",
	"--schema",
	"public",
];
const result = spawnSync("pnpm", args, {
	cwd: root,
	encoding: "utf8",
	maxBuffer: 16 * 1024 * 1024,
});

if (result.error || result.status !== 0) {
	console.error("Supabase schema guard could not generate linked types.");
	if (result.stderr) console.error(result.stderr.trim());
	if (result.error) console.error(result.error.message);
	process.exit(1);
}

if (!result.stdout.includes("export type Database =")) {
	console.error("Supabase schema guard received invalid generated output.");
	process.exit(1);
}

if (result.stdout !== readFileSync(typesPath, "utf8")) {
	console.error("Committed Supabase types do not match velure-cc.");
	console.error("Run `pnpm run supabase:types` and commit the result.");
	process.exit(1);
}

console.log("Committed Supabase types match velure-cc.");
