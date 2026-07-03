import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { convexQueryClient } from "#/integrations/convex/provider";

type AppContext = {
  queryClient: QueryClient;
};

let browserQueryClient: QueryClient | undefined;

function createQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient!.hashFn(),
        queryFn: convexQueryClient!.queryFn(),
        staleTime: 30_000,
        gcTime: 600_000,
      },
    },
  });

  convexQueryClient!.connect(queryClient);

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

export default function TanStackQueryProvider({ children }: { children: ReactNode }) {
  const { queryClient } = getContext();

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
