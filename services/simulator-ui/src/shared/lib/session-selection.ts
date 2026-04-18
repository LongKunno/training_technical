import type { SessionHistoryEntry } from "../types";

export interface ResolveSelectedSessionInput {
  currentSessionId?: string | null;
  selectedSessionId?: string | null;
  sessions: SessionHistoryEntry[];
}

export function resolveSelectedSessionId({
  currentSessionId,
  selectedSessionId,
  sessions,
}: ResolveSelectedSessionInput): string | null {
  if (sessions.length === 0) {
    return null;
  }

  const hasSelectedSession =
    selectedSessionId != null &&
    sessions.some((session) => session.session_id === selectedSessionId);

  if (hasSelectedSession) {
    return selectedSessionId ?? null;
  }

  const currentSession = currentSessionId
    ? sessions.find((session) => session.session_id === currentSessionId)
    : undefined;

  return currentSession?.session_id ?? sessions[0]?.session_id ?? null;
}

