import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "#/components/theme/theme-provider";
import { Toaster } from "../components/ui/toaster";
import ConvexProvider from "../integrations/convex/provider";
import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Velure",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon-outline.svg",
			},
			{
				rel: "alternate icon",
				type: "image/x-icon",
				href: "/favicon-outline.ico",
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground antialiased dark">
				<ThemeProvider>
					<ConvexProvider>
						<TanStackQueryProvider>
							<MotionConfig reducedMotion="user">
								{children}
								<Toaster />
							</MotionConfig>
						</TanStackQueryProvider>
					</ConvexProvider>
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	);
}
