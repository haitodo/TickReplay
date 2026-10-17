import { describe, it, expect } from "vitest";
import { calculatePositionElapsedTime, formatElapsedTime } from "../holdingTime";
import type { VirtualPosition } from "../../types/trading";

describe("calculatePositionElapsedTime", () => {
  const dummyPos1: VirtualPosition = {
    ticket: 1,
    symbol: "USDJPY",
    type: "BUY",
    volume: 1.0,
    open_price: 155.0,
    open_time: 1714554000,
    open_time_msc: 1714554000000,
    profit: 0,
  };

  const dummyPos2: VirtualPosition = {
    ticket: 2,
    symbol: "USDJPY",
    type: "SELL",
    volume: 0.5,
    open_price: 155.5,
    open_time: 1714554010,
    open_time_msc: 1714554010000,
    profit: 0,
  };

  it("ポジションが空の場合は 0 を返す", () => {
    expect(calculatePositionElapsedTime([], "pc", 100000, {})).toBe(0);
    expect(calculatePositionElapsedTime([], "server", 100000, {})).toBe(0);
  });

  describe("PC時間モード", () => {
    it("新規ポジションでストップウォッチ未登録の場合は 0 を返す (巨大な過去時間を引き継がない)", () => {
      const elapsed = calculatePositionElapsedTime([dummyPos1], "pc", 1714554050000, {});
      expect(elapsed).toBe(0);
    });

    it("停止中のポジションは accumulatedMs をそのまま返す", () => {
      const stopwatchStates = {
        "1_1714554000000": {
          accumulatedMs: 12500,
          lastActiveTime: null,
        },
      };
      const elapsed = calculatePositionElapsedTime(
        [dummyPos1],
        "pc",
        1714554050000,
        stopwatchStates,
        1714554060000
      );
      expect(elapsed).toBe(12500);
    });

    it("再生中のポジションは nowMs との差分を加算して返す", () => {
      const stopwatchStates = {
        "1_1714554000000": {
          accumulatedMs: 5000,
          lastActiveTime: 10000,
        },
      };
      const elapsed = calculatePositionElapsedTime(
        [dummyPos1],
        "pc",
        1714554050000,
        stopwatchStates,
        13500 // nowMs
      );
      expect(elapsed).toBe(8500); // 5000 + (13500 - 10000)
    });

    it("複数ポジション存在時は最古ポジションのストップウォッチを参照する", () => {
      const stopwatchStates = {
        "1_1714554000000": {
          accumulatedMs: 20000,
          lastActiveTime: null,
        },
        "2_1714554010000": {
          accumulatedMs: 5000,
          lastActiveTime: null,
        },
      };
      const elapsed = calculatePositionElapsedTime(
        [dummyPos2, dummyPos1], // 順序が逆でも最古(ticket 1)を選ぶ
        "pc",
        1714554050000,
        stopwatchStates
      );
      expect(elapsed).toBe(20000);
    });
  });

  describe("サーバー(Chart)時間モード", () => {
    it("仮想時刻とポジションの open_time_msc の差分を正しく計算する", () => {
      const virtualTime = 1714554015500;
      const elapsed = calculatePositionElapsedTime([dummyPos1], "server", virtualTime, {});
      expect(elapsed).toBe(15500);
    });

    it("virtualTimeMsc が未設定・0 の場合は 0 を返し、巨大な秒数にならない", () => {
      const elapsed = calculatePositionElapsedTime([dummyPos1], "server", 0, {});
      expect(elapsed).toBe(0);
    });

    it("open_time_msc が 0 や異常値の場合は 0 または安全なフォールバックを行う", () => {
      const badPos: VirtualPosition = {
        ...dummyPos1,
        open_time_msc: 0,
        open_time: 0,
      };
      const elapsed = calculatePositionElapsedTime([badPos], "server", 1714554050000, {});
      expect(elapsed).toBe(0);
    });

    it("open_time_msc が秒単位で渡されていた場合はミリ秒に正規化して計算する", () => {
      const secondsPos: VirtualPosition = {
        ...dummyPos1,
        open_time_msc: 1714554000, // 秒単位
      };
      const virtualTime = 1714554020000;
      const elapsed = calculatePositionElapsedTime([secondsPos], "server", virtualTime, {});
      expect(elapsed).toBe(20000);
    });

    it("仮想時刻が open_time より前の場合は 0 にクランプする", () => {
      const virtualTime = 1714553999000;
      const elapsed = calculatePositionElapsedTime([dummyPos1], "server", virtualTime, {});
      expect(elapsed).toBe(0);
    });
  });
});

describe("formatElapsedTime", () => {
  it("1分未満は小数点第1位まで秒を表示", () => {
    expect(formatElapsedTime(0)).toBe("0.0秒");
    expect(formatElapsedTime(5400)).toBe("5.4秒");
    expect(formatElapsedTime(59900)).toBe("59.9秒");
  });

  it("1分以上1時間未満は 分秒.コンマ秒 (秒は2桁0埋め) を表示", () => {
    expect(formatElapsedTime(60000)).toBe("1分00.0秒");
    expect(formatElapsedTime(125400)).toBe("2分05.4秒");
    expect(formatElapsedTime(3599900)).toBe("59分59.9秒");
  });

  it("1時間以上は 時間分秒 を表示", () => {
    expect(formatElapsedTime(3600000)).toBe("1時間0分0秒");
    expect(formatElapsedTime(3665000)).toBe("1時間1分5秒");
  });

  it("負数や NaN は 0.0秒 として安全にフォーマットする", () => {
    expect(formatElapsedTime(-100)).toBe("0.0秒");
    expect(formatElapsedTime(NaN)).toBe("0.0秒");
  });
});
