import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import { defineBoot } from "#q-app/wrappers";

/**
 * TanStack Vue Query bootstrap.
 * Configures a shared QueryClient with 30s stale time, 2 retries,
 * and window-focus refetch enabled.
 */
export default defineBoot(({ app }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 2,
      },
    },
  });

  app.use(VueQueryPlugin, { queryClient });
});
