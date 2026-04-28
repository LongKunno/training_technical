import { useQuery } from "@tanstack/react-query";

import { botApi, coreApi, dataApi } from "../api";
import type { ServiceHealth, UpstreamAvailability } from "../types";
import { botQueryKeys, dataQueryKeys, paperQueryKeys } from "./keys";

interface QueryHookOptions {
  enabled?: boolean;
  staleTime?: number;
}

const DEFAULT_STALE_TIME = 5_000;

function isEnabled(enabled: boolean | undefined): boolean {
  return enabled ?? true;
}

export function resolveServiceAvailability(input: {
  data?: ServiceHealth | null;
  isError: boolean;
  isPending: boolean;
}): UpstreamAvailability {
  if (input.isError) {
    return "down";
  }

  if (input.isPending || !input.data) {
    return "unknown";
  }

  return input.data.status === "ok" ? "healthy" : "degraded";
}

export function useCoreHealthQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getHealth({ signal }),
    queryKey: paperQueryKeys.health(),
    retry: 1,
    staleTime: options.staleTime ?? DEFAULT_STALE_TIME,
  });
}

export function useDataHealthQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => dataApi.getHealth({ signal }),
    queryKey: dataQueryKeys.health(),
    retry: 1,
    staleTime: options.staleTime ?? DEFAULT_STALE_TIME,
  });
}

export function useBotHealthQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => botApi.getHealth({ signal }),
    queryKey: botQueryKeys.health(),
    retry: 1,
    staleTime: options.staleTime ?? DEFAULT_STALE_TIME,
  });
}
