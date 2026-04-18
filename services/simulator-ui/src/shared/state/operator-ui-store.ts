import { create } from "zustand";

import { resolveSelectedSessionId } from "../lib";
import type {
  QueryParams,
  SessionHistoryEntry,
  SessionStatus,
  TimelineStreamStatus,
} from "../types";

export interface SessionHistoryViewState extends QueryParams {
  limit: number;
  offset: number;
  q: string;
  status: SessionStatus | "";
}

interface OperatorUiState {
  selectedSessionId: string | null;
  sessionHistory: SessionHistoryViewState;
  setSelectedSessionId: (sessionId: string | null) => void;
  setSessionLimit: (limit: number) => void;
  setSessionPage: (page: number) => void;
  setSessionSearch: (query: string) => void;
  setSessionStatus: (status: SessionStatus | "") => void;
  setTimelineStreamStatus: (status: TimelineStreamStatus) => void;
  syncSelectedSession: (
    sessions: SessionHistoryEntry[],
    currentSessionId?: string | null,
  ) => void;
  timelineStreamStatus: TimelineStreamStatus;
  resetSessionHistory: () => void;
}

export const DEFAULT_SESSION_HISTORY_VIEW: SessionHistoryViewState = {
  limit: 20,
  offset: 0,
  q: "",
  status: "",
};

export const useOperatorUiStore = create<OperatorUiState>()((set, get) => ({
  selectedSessionId: null,
  sessionHistory: DEFAULT_SESSION_HISTORY_VIEW,
  timelineStreamStatus: "idle",

  setSelectedSessionId: (sessionId) => {
    set({ selectedSessionId: sessionId });
  },

  setSessionLimit: (limit) => {
    set((state) => ({
      sessionHistory: {
        ...state.sessionHistory,
        limit: limit > 0 ? limit : state.sessionHistory.limit,
        offset: 0,
      },
    }));
  },

  setSessionPage: (page) => {
    const safePage = page < 0 ? 0 : page;
    set((state) => ({
      sessionHistory: {
        ...state.sessionHistory,
        offset: safePage * state.sessionHistory.limit,
      },
    }));
  },

  setSessionSearch: (query) => {
    set((state) => ({
      sessionHistory: {
        ...state.sessionHistory,
        offset: 0,
        q: query.trim(),
      },
    }));
  },

  setSessionStatus: (status) => {
    set((state) => ({
      sessionHistory: {
        ...state.sessionHistory,
        offset: 0,
        status,
      },
    }));
  },

  setTimelineStreamStatus: (status) => {
    set({ timelineStreamStatus: status });
  },

  syncSelectedSession: (sessions, currentSessionId) => {
    const selectedSessionId = resolveSelectedSessionId({
      currentSessionId,
      selectedSessionId: get().selectedSessionId,
      sessions,
    });

    set({ selectedSessionId });
  },

  resetSessionHistory: () => {
    set({ sessionHistory: DEFAULT_SESSION_HISTORY_VIEW });
  },
}));

export const selectSelectedSessionId = (state: OperatorUiState) => state.selectedSessionId;
export const selectSessionHistoryFilter = (state: OperatorUiState) => state.sessionHistory;
export const selectTimelineStreamStatus = (state: OperatorUiState) =>
  state.timelineStreamStatus;
