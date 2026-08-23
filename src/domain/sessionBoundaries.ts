export interface SessionBoundaryInfo {
  idx: number;
  type: "TYO" | "LDN" | "NY";
}

export interface RawSessionBoundaries {
  TYO?: number[];
  LDN?: number[];
  NY?: number[];
}

/**
 * 原生のセッション境界インデックス配列をソートされた単一のセッション一覧に変換
 */
export const organizeSessions = (boundaries: RawSessionBoundaries | null | undefined): SessionBoundaryInfo[] => {
  const sessions: SessionBoundaryInfo[] = [];
  if (!boundaries) return sessions;

  if (boundaries.TYO && Array.isArray(boundaries.TYO)) {
    boundaries.TYO.forEach((idx: number) => sessions.push({ idx, type: "TYO" }));
  }
  if (boundaries.LDN && Array.isArray(boundaries.LDN)) {
    boundaries.LDN.forEach((idx: number) => sessions.push({ idx, type: "LDN" }));
  }
  if (boundaries.NY && Array.isArray(boundaries.NY)) {
    boundaries.NY.forEach((idx: number) => sessions.push({ idx, type: "NY" }));
  }

  sessions.sort((a, b) => a.idx - b.idx);
  return sessions;
};

/**
 * 現在のインデックスより後の最初のセッションインデックスを取得
 */
export const getNextSessionIndex = (sessions: SessionBoundaryInfo[], currentIdx: number): number | null => {
  const next = sessions.find(s => s.idx > currentIdx);
  return next ? next.idx : null;
};

/**
 * 現在のインデックスより前の最後のセッションインデックスを取得
 */
export const getPrevSessionIndex = (sessions: SessionBoundaryInfo[], currentIdx: number): number | null => {
  const prevList = sessions.filter(s => s.idx < currentIdx);
  return prevList.length > 0 ? prevList[prevList.length - 1].idx : null;
};

/**
 * 現在のインデックスにおけるアクティブなセッション情報を取得
 */
export const getCurrentSession = (sessions: SessionBoundaryInfo[], currentIdx: number): SessionBoundaryInfo | null => {
  const pastSessions = sessions.filter(s => s.idx <= currentIdx);
  return pastSessions.length > 0 ? pastSessions[pastSessions.length - 1] : null;
};
