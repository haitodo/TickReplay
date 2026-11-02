import type { ReplayProgressPayload } from "../types/replay";

export type PendingReplayStatus = ReplayProgressPayload & { pending_session_start?: true };

export function isReplaySessionStart(status: PendingReplayStatus): boolean {
  return status.pending_session_start === true || (status.status === "READY" && (
    status.message === "Replay Core v2 初期化完了"
    || (status.current_idx === 0 && status.history?.length === 0 && status.positions?.length === 0)
  ));
}

function isPlaybackStatus(status: ReplayProgressPayload): boolean {
  return status.status === "READY" || status.status === "ACTIVE";
}

/**
 * History and audit arrays are complete snapshots sent only when their revision
 * changes. Keep an unpainted snapshot when a newer frame omits that same revision.
 * Other fields always come from the newest frame; arrays are never concatenated.
 */
export function mergePendingReplayStatus(
  previous: PendingReplayStatus | null,
  incoming: PendingReplayStatus,
): PendingReplayStatus {
  if (isReplaySessionStart(incoming)) return { ...incoming, pending_session_start: true };
  if (!previous || !isPlaybackStatus(previous) || !isPlaybackStatus(incoming)) {
    return incoming;
  }
  if ((previous.seek_epoch !== incoming.seek_epoch
      && (previous.seek_epoch === undefined || incoming.seek_epoch === undefined || incoming.seek_epoch < previous.seek_epoch))
    || (previous.source_symbol !== undefined && incoming.source_symbol !== undefined && previous.source_symbol !== incoming.source_symbol)
    || (previous.total_ticks !== undefined && incoming.total_ticks !== undefined && previous.total_ticks !== incoming.total_ticks)
    || (previous.history_revision !== undefined && incoming.history_revision !== undefined && incoming.history_revision < previous.history_revision)
    || (previous.trade_revision !== undefined && incoming.trade_revision !== undefined && incoming.trade_revision < previous.trade_revision)) {
    return incoming;
  }

  const keepHistory = incoming.history === undefined && previous.history !== undefined
    && incoming.history_revision !== undefined && incoming.history_revision === previous.history_revision;
  const keepAudits = incoming.execution_audits === undefined && previous.execution_audits !== undefined
    && incoming.trade_revision !== undefined && incoming.trade_revision === previous.trade_revision;
  if (!keepHistory && !keepAudits && !previous.pending_session_start) return incoming;
  return {
    ...incoming,
    ...(keepHistory ? { history: previous.history } : {}),
    ...(keepAudits ? { execution_audits: previous.execution_audits } : {}),
    ...(previous.pending_session_start ? { pending_session_start: true as const } : {}),
  };
}
