import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";

type AppContext = {
  queryClient: QueryClient;
};

let browserQueryClient: QueryClient | undefined;

function createQueryClient() {
  return new QueryClient();
}

function getQueryClient() {
  if (isServer) {
    return createQueryClient();
  }

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
