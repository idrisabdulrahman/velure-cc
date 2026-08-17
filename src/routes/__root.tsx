import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";
import { TextSizeProvider } from "#/components/text-size/text-size-provider";
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
		scripts: [
			{
				// Applies the persisted theme to <html> before first paint: the CSS
				// :root default is light, so an unhandled dark preference (also the
				// app default) would flash white on every reload until hydration.
				children: `(function(){try{var e=localStorage.getItem("velure.theme");var t=e==="light"?"light":"dark";var r=document.documentElement;r.classList.remove("light","dark");r.classList.add(t);r.style.colorScheme=t}catch(e){}})();`,
			},
			{
				children: `(function(){try{var s=localStorage.getItem("velure.textSize");if(s==="sm"||s==="lg"){document.documentElement.classList.add("text-"+s)}}catch(e){}})();`,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground antialiased">
				<ThemeProvider>
					<TextSizeProvider>
						<ConvexProvider>
							<TanStackQueryProvider>
								<MotionConfig reducedMotion="user">
									{children}
									<Toaster />
								</MotionConfig>
							</TanStackQueryProvider>
						</ConvexProvider>
					</TextSizeProvider>
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	);
}
