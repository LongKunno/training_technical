import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { openCurrentTimelineStream } from "../api";
import { useOperatorUiStore } from "../state";
import type { SessionTimelinePoint, TimelineStreamStatus } from "../types";
import { applyCurrentTimelinePoint, invalidateCurrentRealtimeQueries } from "./paper";

const DEFAULT_RECONNECT_DELAY_MS = 1500;

export interface UseCurrentTimelineStreamOptions {
  enabled?: boolean;
  eventSourceFactory?: (url: string) => EventSource;
  onPoint?: (point: SessionTimelinePoint) => void;
  reconnectDelayMs?: number;
}

export function useCurrentTimelineStream(
  options: UseCurrentTimelineStreamOptions = {},
) {
  const {
    enabled = true,
    eventSourceFactory,
    onPoint,
    reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  } = options;
  const queryClient = useQueryClient();
  const [error, setError] = useState<Error | null>(null);
  const [lastPoint, setLastPoint] = useState<SessionTimelinePoint | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [status, setStatus] = useState<TimelineStreamStatus>(enabled ? "connecting" : "idle");
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    useOperatorUiStore.setState({
      timelineStreamStatus: enabled ? "connecting" : "idle",
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;
    let eventSource: EventSource | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (disposed) {
          return;
        }

        setReconnectCount((count) => count + 1);
        connect();
      }, reconnectDelayMs);
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      setStatus("connecting");
      useOperatorUiStore.setState({ timelineStreamStatus: "connecting" });

      eventSource = openCurrentTimelineStream(eventSourceFactory);

      eventSource.onopen = () => {
        if (disposed) {
          return;
        }

        clearReconnectTimer();
        setStatus("open");
        setError(null);
        useOperatorUiStore.setState({ timelineStreamStatus: "open" });
      };

      eventSource.addEventListener("timeline", (event) => {
        if (disposed) {
          return;
        }

        try {
          const messageEvent = event as MessageEvent<string>;
          const point = JSON.parse(messageEvent.data) as SessionTimelinePoint;
          setLastPoint(point);
          setError(null);
          applyCurrentTimelinePoint(queryClient, point);
          void invalidateCurrentRealtimeQueries(queryClient);
          onPoint?.(point);
        } catch (caughtError) {
          const nextError =
            caughtError instanceof Error
              ? caughtError
              : new Error("failed to parse timeline event");
          setError(nextError);
        }
      });

      eventSource.onerror = () => {
        if (disposed) {
          return;
        }

        setStatus("degraded");
        useOperatorUiStore.setState({ timelineStreamStatus: "degraded" });
        eventSource?.close();
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      eventSource?.close();
      useOperatorUiStore.setState({ timelineStreamStatus: "idle" });
    };
  }, [enabled, eventSourceFactory, onPoint, queryClient, reconnectDelayMs]);

  return {
    error: enabled ? error : null,
    lastPoint: enabled ? lastPoint : null,
    reconnectCount,
    status: enabled ? status : "idle",
  };
}
