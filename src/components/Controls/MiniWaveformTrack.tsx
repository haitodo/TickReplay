import React, { useEffect, useRef } from "react";
import type { DayTimelineActivity } from "../../types/replay";

interface MiniWaveformTrackProps {
  activity: DayTimelineActivity | null;
  currentSecInDay: number;
}

export const MiniWaveformTrack: React.FC<MiniWaveformTrackProps> = React.memo(({
  activity,
  currentSecInDay,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    if (!activity || !activity.slots_15m || activity.slots_15m.length === 0) {
      return;
    }

    const currentX = Math.max(0, Math.min(w, (currentSecInDay / 86400) * w));

    // 1. 未来（未再生区間）: 1時間単位のぼかしグラデーション帯
    if (activity.slots_1h && activity.slots_1h.length === 24) {
      const slot1hW = w / 24;
      for (let i = 0; i < 24; i++) {
        const xStart = i * slot1hW;
        const xEnd = (i + 1) * slot1hW;
        if (xEnd > currentX) {
          const drawStart = Math.max(xStart, currentX);
          const intensity = activity.slots_1h[i] || 0;
          if (intensity > 0.05) {
            // 活動度に応じた淡いぼかし色 (薄いスレート〜控えめなアンバー)
            const alpha = Math.min(0.35, intensity * 0.4);
            const r = Math.round(99 + intensity * (245 - 99));
            const g = Math.round(102 + intensity * (158 - 102));
            const b = Math.round(241 + intensity * (11 - 241));
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            ctx.fillRect(drawStart, 0, xEnd - drawStart, h);
          }
        }
      }
    }

    // 2. 過去（再生済み区間）: 15分刻みの明確なバーグラフ
    const slots96 = activity.slots_15m;
    const slot96W = w / 96;
    for (let i = 0; i < 96; i++) {
      const xStart = i * slot96W;
      const xCenter = xStart + slot96W / 2;
      if (xCenter <= currentX) {
        const intensity = slots96[i] || 0;
        const barH = Math.max(1.5, intensity * (h - 2));
        const barW = Math.max(1, slot96W - 1);
        const yTop = h - barH;

        if (intensity >= 0.7) {
          ctx.fillStyle = "rgba(245, 158, 11, 0.85)"; // 高活動: 鮮やかなアンバー/オレンジ
        } else if (intensity >= 0.35) {
          ctx.fillStyle = "rgba(56, 189, 248, 0.75)"; // 中活動: シアン
        } else {
          ctx.fillStyle = "rgba(148, 163, 184, 0.35)"; // 低活動: 薄いスレート
        }

        ctx.fillRect(xStart + 0.5, yTop, barW, barH);
      }
    }

    // 3. セッション境界ライン (TYO, LDN, NY)
    const drawSessionLine = (sec: number, color: string) => {
      if (sec <= 0 || sec >= 86400) return;
      const lx = (sec / 86400) * w;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, h);
      ctx.stroke();
    };

    drawSessionLine(activity.tyo_start_sec, "rgba(29, 185, 84, 0.6)");  // TYO: 緑
    drawSessionLine(activity.ldn_start_sec, "rgba(49, 130, 206, 0.6)"); // LDN: 青
    drawSessionLine(activity.ny_start_sec, "rgba(229, 62, 62, 0.6)");   // NY: 赤
  }, [activity, currentSecInDay]);

  return (
    <canvas
      ref={canvasRef}
      className="seeker-waveform-canvas"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        borderRadius: "3px",
      }}
    />
  );
});
