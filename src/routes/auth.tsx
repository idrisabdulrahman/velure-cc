import { createFileRoute } from "@tanstack/react-router";
import { validateAuthSearch } from "#/lib/auth-search";

export const Route = createFileRoute("/auth")({
	validateSearch: validateAuthSearch,
});
