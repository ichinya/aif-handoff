import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
    staleTime: 60_000,
  });
}

export function useAgentReadiness() {
  return useQuery({
    queryKey: ["agentReadiness"],
    queryFn: api.getAgentReadiness,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useProjectDefaults(projectId: string | null) {
  return useQuery({
    queryKey: ["projectDefaults", projectId],
    queryFn: () => api.getProjectDefaults(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}
