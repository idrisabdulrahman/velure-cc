import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

const root = process.cwd();
const convexDir = join(root, "convex");
const sourceDirs = [join(root, "src")];
const sourceExtensions = new Set([".ts", ".tsx"]);
const publicFunctionPattern =
	/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(query|mutation|action|httpAction)\s*\(/g;
const convexApiImportPattern =
	/import\s*\{\s*api\s*\}\s*from\s*["'][^"']*convex\/_generated\/api["']/;
const apiReferencePattern =
	/\bapi\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b/g;

function walkFiles(dir, predicate) {
	const files = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry === "_generated") continue;
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			files.push(...walkFiles(fullPath, predicate));
			continue;
		}
		if (predicate(fullPath)) files.push(fullPath);
	}
	return files;
}

function collectPublicConvexFunctions() {
	const modules = new Map();
	const files = walkFiles(
		convexDir,
		(file) =>
			sourceExtensions.has(extname(file)) &&
			!file.endsWith(".test.ts") &&
			!file.endsWith(".test.tsx"),
	);

	for (const file of files) {
		const moduleName = basename(file, extname(file));
		const source = readFileSync(file, "utf8");
		const functions = new Set();
		for (const match of source.matchAll(publicFunctionPattern)) {
			functions.add(match[1]);
		}
		if (functions.size > 0) {
			modules.set(moduleName, functions);
		}
	}

	return modules;
}

function collectApiReferences() {
	const references = [];
	const files = sourceDirs.flatMap((dir) =>
		walkFiles(
			dir,
			(file) =>
				sourceExtensions.has(extname(file)) &&
				!file.endsWith(".test.ts") &&
				!file.endsWith(".test.tsx"),
		),
	);

	for (const file of files) {
		const source = readFileSync(file, "utf8");
		if (!convexApiImportPattern.test(source)) continue;
		for (const match of source.matchAll(apiReferencePattern)) {
			references.push({
				file,
				moduleName: match[1],
				functionName: match[2],
			});
		}
	}

	return references;
}

const publicFunctions = collectPublicConvexFunctions();
const missing = collectApiReferences().filter(({ moduleName, functionName }) => {
	return !publicFunctions.get(moduleName)?.has(functionName);
});

if (missing.length > 0) {
	console.error("Convex API reference check failed.");
	console.error(
		"Run `pnpm run convex:sync` after adding or renaming Convex functions.",
	);
	for (const item of missing) {
		console.error(
			`- ${item.file}: api.${item.moduleName}.${item.functionName} has no public Convex export`,
		);
	}
	process.exit(1);
}

console.log("Convex API references are backed by public Convex exports.");
