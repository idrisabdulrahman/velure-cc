// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useSupabaseSession } from "./supabase-session";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

it("renews the Supabase JWT before the server's 30 minute expiry", async () => {
	vi.useFakeTimers();
	const fetchSession = vi.fn().mockImplementation(async () =>
		Response.json({
			ok: true,
			accessToken: `token-${fetchSession.mock.calls.length}`,
			expiresAt: Math.floor(Date.now() / 1000) + 30 * 60,
			velureUserId: "user-1",
		}),
	);
	vi.stubGlobal("fetch", fetchSession);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const queryClient = new QueryClient();
	function Probe() {
		const { velureUserId } = useSupabaseSession("user-1");
		return <span>{velureUserId}</span>;
	}
	await act(async () => {
		root.render(
			<QueryClientProvider client={queryClient}>
				<Probe />
			</QueryClientProvider>,
		);
	});
	expect(fetchSession).toHaveBeenCalledTimes(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
	});
	expect(fetchSession).toHaveBeenCalledTimes(2);
	expect(
		queryClient.getQueryData<{ accessToken: string }>([
			"supabase-session",
			"user-1",
		])?.accessToken,
	).toBe("token-2");
	await act(async () => root.unmount());
	queryClient.clear();
});
