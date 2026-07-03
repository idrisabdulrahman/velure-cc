import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { useLocation } from "@tanstack/react-router";
import { ConvexProvider } from "convex/react";
import { authClient } from "#/lib/auth-client";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;
export const convexQueryClient = CONVEX_URL ? new ConvexQueryClient(CONVEX_URL) : null;

export default function AppConvexProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const location = useLocation();

	if (!convexQueryClient) {
		console.warn(
			"VITE_CONVEX_URL is missing; rendering without Convex provider",
		);
		return <>{children}</>;
	}

	if (location.pathname.startsWith("/i/")) {
		return (
			<ConvexProvider client={convexQueryClient.convexClient}>
				{children}
			</ConvexProvider>
		);
	}

	return (
		<ConvexBetterAuthProvider
			client={convexQueryClient.convexClient}
			authClient={authClient}
		>
			{children}
		</ConvexBetterAuthProvider>
	);
}
