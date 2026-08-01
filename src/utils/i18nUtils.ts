export const translateErrorMessage = (msg: string): string => {
  if (!msg) return "";
  const lowerMsg = msg.toLowerCase();

  if (lowerMsg.includes("margin is insufficient")) {
    return "証拠金が不足しているため、ポジションを発注できません。";
  }
  if (lowerMsg.includes("replay is not initialized or tick data empty")) {
    return "リプレイが初期化されていないか、ティックデータが空です。";
  }
  if (lowerMsg.includes("failed to obtain current bid/ask prices")) {
    return "現在の気配値（Bid/Ask）を取得できませんでした。";
  }
  if (lowerMsg.includes("a-b loop error: loop a is not set")) {
    return "A-Bループエラー: ループAが設定されていません。";
  }
  if (lowerMsg.includes("a-b loop error: loop b must be after loop a")) {
    return "A-Bループエラー: ループBはループAより後の時間である必要があります。";
  }
  if (lowerMsg.startsWith("initialization error:")) {
    return "初期化エラー: " + msg.substring("initialization error:".length).trim();
  }
  if (lowerMsg.startsWith("command error:")) {
    return "コマンド送信エラー: " + msg.substring("command error:".length).trim();
  }

  return msg;
};
