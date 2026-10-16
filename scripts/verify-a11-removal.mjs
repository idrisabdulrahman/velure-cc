import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (file) => readFileSync(join(root, file), "utf8");
const failures = [];

if (existsSync(join(root, "convex"))) failures.push("convex/ still exists");

const packageText = read("package.json");
const lockText = read("pnpm-lock.yaml");
for (const name of ["convex", "@convex-dev/better-auth", "@convex-dev/react-query"]) {
	if (packageText.includes(`\"${name}\"`)) failures.push(`${name} remains in package.json`);
	if (lockText.includes(name)) failures.push(`${name} remains in pnpm-lock.yaml`);
}

const sourceFiles = [
	"src/lib/auth.ts",
	"src/lib/auth-client.ts",
	"src/routes/api/auth/$.ts",
	"src/integrations/tanstack-query/root-provider.tsx",
	"src/routes/__root.tsx",
];
const runtimePattern = /(?:from\s+["']convex|@convex-dev|convexQuery|useConvex|ConvexProvider|convex\/_generated)/;
for (const file of sourceFiles) {
	if (runtimePattern.test(read(file))) failures.push(`${file} contains a Convex runtime reference`);
}

if (read("src/lib/auth.ts").includes("ISSUER_URL")) {
	failures.push("external Better Auth issuer remains configured");
}
if (!read("src/routes/api/auth/$.ts").includes("auth.handler(request)")) {
	failures.push("auth route is not wired to the app auth handler");
}

if (failures.length) {
	console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
	process.exit(1);
}

console.log("A11 removal verification passed.");
