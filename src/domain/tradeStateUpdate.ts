/**
 * 再生ステータス (ReplayProgressPayload) から取引状態
 * (口座・メインレート・サブレート・ポジション・履歴) を反映するための純粋ロジック。
 *
 * App.tsx の READY / ACTIVE 分岐に同一の処理が二重化していたため切り出した。
 * すべて「前の値を引数で受け取り、次の値を返す」形にしてある。React の関数型更新
 * (setX(prev => ...)) から呼ぶことで、描画時点の古い状態を比較に使わない。
 * 変化が無い場合は引数の prev をそのまま返すので参照が安定し、再描画されない。
 *
 * ここには副作用を置かない。historyRevisionRef の更新は購読側 (App.tsx) に残す。
 */

import type { TradeHistoryItem, VirtualAccount, VirtualPosition } from "../types/trading";
import type { ReplayProgressPayload } from "../types/replay";

export interface FeedRate {
  bid: number;
  ask: number;
  spread: number;
}

export interface SubFeedRate extends FeedRate {
  active: boolean;
  symbol: string;
}

type FeedRateInput = Pick<ReplayProgressPayload, "bid" | "ask" | "spread">;
type SubFeedRateInput = Pick<
  ReplayProgressPayload,
  "dual_feed" | "sub_symbol" | "sub_bid" | "sub_ask" | "sub_spread"
>;

/**
 * 口座情報の高速等価比較 (JSON.stringify による毎フレームのGCアロケーションを抑止)
 */
export function isAccountEqual(a: VirtualAccount | null, b?: VirtualAccount): boolean {
  if (!a || !b) return a === b;
  return (
    a.balance === b.balance &&
    a.equity === b.equity &&
    a.margin === b.margin &&
    a.free_margin === b.free_margin &&
    a.margin_level === b.margin_level &&
    a.total_profit === b.total_profit &&
    a.leverage === b.leverage
  );
}

/**
 * 保有ポジション配列の高速等価比較 (JSON.stringify による毎フレームのGCアロケーションを抑止)
 */
export function arePositionsEqual(a?: VirtualPosition[], b?: VirtualPosition[]): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i];
    const p2 = b[i];
    if (
      p1.ticket !== p2.ticket ||
      p1.type !== p2.type ||
      p1.volume !== p2.volume ||
      p1.open_price !== p2.open_price ||
      p1.current_price !== p2.current_price ||
      p1.profit !== p2.profit ||
      p1.sl !== p2.sl ||
      p1.tp !== p2.tp ||
      p1.mfe_pips !== p2.mfe_pips ||
      p1.mae_pips !== p2.mae_pips
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 口座を反映する。ペイロードに口座が無ければ前の値を維持する
 * (null を送っても消えない。クリアは DISCONNECTED 分岐が担当する)。
 */
export function nextAccount(
  prev: VirtualAccount | null,
  incoming?: VirtualAccount
): VirtualAccount | null {
  if (!incoming) return prev;
  if (isAccountEqual(prev, incoming)) return prev;
  return incoming;
}

/** ポジションを反映する。ペイロードに無ければ維持し、空配列は空配列として反映する。 */
export function nextPositions(
  prev: VirtualPosition[],
  incoming?: VirtualPosition[]
): VirtualPosition[] {
  if (!incoming) return prev;
  if (arePositionsEqual(prev, incoming)) return prev;
  return incoming;
}

/**
 * メインレートを反映する。bid / ask は両方揃っているときだけ更新し、
 * 片方だけのときは前の値を維持する (spread 未指定は 0 として扱う)。
 */
export function nextMainFeedRate(prev: FeedRate, data: FeedRateInput): FeedRate {
  const { bid, ask } = data;
  if (bid === undefined || ask === undefined) return prev;
  const spread = data.spread !== undefined ? data.spread : 0;
  if (prev.bid === bid && prev.ask === ask && prev.spread === spread) return prev;
  return { bid, ask, spread };
}

/**
 * サブレートを反映する。dual_feed が false または省略ならクリアする
 * (既に null なら参照を維持する)。有効時は等価なら前の値、変化があれば新しい値。
 */
export function nextSubFeedRate(
  prev: SubFeedRate | null,
  data: SubFeedRateInput
): SubFeedRate | null {
  if (!data.dual_feed) {
    return prev === null ? prev : null;
  }
  const symbol = data.sub_symbol || "";
  const bid = data.sub_bid || 0;
  const ask = data.sub_ask || 0;
  const spread = data.sub_spread !== undefined ? data.sub_spread : 0;
  if (
    prev &&
    prev.active &&
    prev.symbol === symbol &&
    prev.bid === bid &&
    prev.ask === ask &&
    prev.spread === spread
  ) {
    return prev;
  }
  return { active: true, symbol, bid, ask, spread };
}

/**
 * 履歴を反映すべきか判定する。true のとき history は必ず存在する。
 *
 * - 履歴が省略されていれば false (revision も据え置き)
 * - revision が省略されていれば true (無条件に反映)
 * - revision が適用済みと同じなら false (同一 revision での再描画を抑止)
 */
export function shouldApplyHistory(
  history: TradeHistoryItem[] | undefined,
  historyRevision: number | undefined,
  appliedRevision: number | undefined
): history is TradeHistoryItem[] {
  if (!history) return false;
  if (historyRevision === undefined) return true;
  return appliedRevision !== historyRevision;
}
