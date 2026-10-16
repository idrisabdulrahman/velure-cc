import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

type AppContext = {
	queryClient: QueryClient;
};

let browserQueryClient: QueryClient | undefined;

function createQueryClient() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				gcTime: 600_000,
			},
		},
	});

	return queryClient;
}

function getQueryClient() {
	if (!browserQueryClient) {
		browserQueryClient = createQueryClient();
	}

	return browserQueryClient;
}

export function getContext() {
	return { queryClient: getQueryClient() } satisfies AppContext;
}

export default function TanStackQueryProvider({
	children,
}: {
	children: ReactNode;
}) {
	const { queryClient } = getContext();

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
