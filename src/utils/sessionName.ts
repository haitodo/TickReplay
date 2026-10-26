const pad2 = (value: number): string => String(value).padStart(2, "0");

export const formatReplaySessionName = (symbol: string, date: Date): string =>
  `${symbol}_Replay_${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_${pad2(
    date.getHours()
  )}${pad2(date.getMinutes())}`;
