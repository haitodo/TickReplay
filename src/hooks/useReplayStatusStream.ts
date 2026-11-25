import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { COMMANDS } from "../constants/commands";
import { EVENTS } from "../constants/events";
import { mergePendingReplayStatus, type PendingReplayStatus } from "../domain/pendingReplayStatus";
import { resolveWindowVisibility } from "../domain/windowVisibility";
import type { ReplayProgressPayload } from "../types/replay";

export interface UseReplayStatusStreamOptions {
  /** 解析済みの最新ステータスを受け取るハンドラ (ref 経由で常に最新を参照) */
  onStatus: (payload: ReplayProgressPayload) => void;
  /** ERROR ステータス受信時の即時ハンドラ (省略時は onStatus に渡される) */
  onErrorImmediate?: (payload: ReplayProgressPayload) => void;
  /** マウント時に get_last_status を呼び出して初期同期するか */
  loadInitialStatus?: boolean;
  /** 非表示中も execution_audits を含むペイロードは即マージ保持するか */
  preserveAuditsWhileHidden?: boolean;
  /** DEV 環境でのスロットルログ出力用ラベル */
  devThrottleLogLabel?: string;
}

/**
 * Tauri の `mt5-status` イベント購読を、ウィンドウ可視性に応じた休眠と
 * `requestAnimationFrame` によるフレーム間引きで一元管理する共通フック。
 */
export function useReplayStatusStream({
  onStatus,
  onErrorImmediate,
  loadInitialStatus = false,
  preserveAuditsWhileHidden = false,
  devThrottleLogLabel,
}: UseReplayStatusStreamOptions) {
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const onErrorRef = useRef(onErrorImmediate);
  onErrorRef.current = onErrorImmediate;

  const pendingStatusRef = useRef<PendingReplayStatus | null>(null);
  const pendingRawRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const skippedCountRef = useRef<number>(0);
  const isVisibleRef = useRef<boolean>(true);

  const clearPending = useCallback(() => {
    pendingRawRef.current = null;
    pendingStatusRef.current = null;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenStatus: (() => void) | undefined;
    let unlistenVisible: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    const flushDeferredRaw = () => {
      const raw = pendingRawRef.current;
      if (raw === null) return;
      pendingRawRef.current = null;
      try {
        const parsed = JSON.parse(raw) as ReplayProgressPayload;
        pendingStatusRef.current = mergePendingReplayStatus(pendingStatusRef.current, parsed);
      } catch (error) {
        console.error("Failed to parse deferred replay status:", error);
      }
    };

    const flushPendingOnShow = () => {
      if (disposed) return;
      flushDeferredRaw();
      if (pendingStatusRef.current !== null) {
        const latest = pendingStatusRef.current;
        pendingStatusRef.current = null;
        onStatusRef.current(latest);
      }
    };

    const scheduleStatus = (payload: string) => {
      if (disposed) return;
      const hidden = !isVisibleRef.current || document.hidden;

      if (
        hidden &&
        !payload.includes('"ERROR"') &&
        !payload.includes('"DISCONNECTED"') &&
        !payload.includes('"TERMINATE"') &&
        !payload.includes('"history"') &&
        (!preserveAuditsWhileHidden || !payload.includes('"execution_audits"'))
      ) {
        pendingRawRef.current = payload;
        return;
      }

      let data: ReplayProgressPayload;
      try {
        data = JSON.parse(payload) as ReplayProgressPayload;
      } catch (error) {
        console.error("Failed to parse replay status:", error);
        return;
      }

      if (data.status === "ERROR") {
        if (onErrorRef.current) {
          onErrorRef.current(data);
        } else {
          onStatusRef.current(data);
        }
        return;
      }

      if (pendingStatusRef.current !== null) {
        skippedCountRef.current++;
      }
      flushDeferredRaw();
      pendingStatusRef.current = mergePendingReplayStatus(pendingStatusRef.current, data);

      if (hidden) {
        return;
      }

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          if (disposed) return;
          if (pendingRawRef.current !== null || pendingStatusRef.current !== null) {
            flushPendingOnShow();
            if (import.meta.env.DEV && devThrottleLogLabel && skippedCountRef.current > 0) {
              console.debug(`[DEV-UI-THROTTLE:${devThrottleLogLabel}] skipped render passes:`, skippedCountRef.current);
              skippedCountRef.current = 0;
            }
          }
        });
      }
    };

    const currentWin = getCurrentWindow();
    const currentLabel = currentWin.label;
    currentWin
      .isVisible()
      .then((visible) => {
        if (!disposed) {
          isVisibleRef.current = visible;
          if (visible && !document.hidden) {
            flushPendingOnShow();
          }
        }
      })
      .catch(() => {});

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        currentWin
          .isVisible()
          .then((visible) => {
            if (!disposed) {
              isVisibleRef.current = visible;
              if (visible) flushPendingOnShow();
            }
          })
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (loadInitialStatus) {
      invoke<string>(COMMANDS.getLastStatus)
        .then((last) => {
          if (!disposed && last && last.trim() !== "") {
            try {
              const parsed = JSON.parse(last) as ReplayProgressPayload;
              onStatusRef.current(parsed);
            } catch (err) {
              console.error("Failed to parse initial status:", err);
            }
          }
        })
        .catch(() => {});
    }

    listen<string>(EVENTS.mt5Status, (event) => {
      scheduleStatus(event.payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlistenStatus = fn;
      })
      .catch(() => {});

    listen<unknown>(EVENTS.windowVisible, (event) => {
      const nextVisible = resolveWindowVisibility(currentLabel, event.payload, true);
      if (nextVisible === null) {
        if (typeof event.payload === "boolean") {
          currentWin
            .isVisible()
            .then((visible) => {
              if (!disposed) {
                isVisibleRef.current = visible;
                if (visible) flushPendingOnShow();
              }
            })
            .catch(() => {});
        }
        return;
      }
      isVisibleRef.current = nextVisible;
      if (nextVisible) flushPendingOnShow();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlistenVisible = fn;
      })
      .catch(() => {});

    currentWin
      .onFocusChanged(({ payload: focused }) => {
        if (focused && !disposed) {
          isVisibleRef.current = true;
          flushPendingOnShow();
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlistenFocus = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingRawRef.current = null;
      pendingStatusRef.current = null;
      if (unlistenStatus) unlistenStatus();
      if (unlistenVisible) unlistenVisible();
      if (unlistenFocus) unlistenFocus();
    };
  }, [loadInitialStatus, preserveAuditsWhileHidden, devThrottleLogLabel]);

  return { clearPending };
}
