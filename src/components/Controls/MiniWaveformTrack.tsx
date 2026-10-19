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
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const [sizeVersion, setSizeVersion] = React.useState(0);

  // リサイズ検知: ウィンドウサイズ変更時のみ canvas.width / canvas.height を設定し、GPU テクスチャ再確保を極小化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = (width: number, height: number) => {
      const dpr = window.devicePixelRatio || 1;
      const pixelW = Math.round(width * dpr);
      const pixelH = Math.round(height * dpr);
      if (pixelW > 0 && pixelH > 0) {
        if (canvas.width !== pixelW || canvas.height !== pixelH) {
          canvas.width = pixelW;
          canvas.height = pixelH;
        }
        sizeRef.current = { w: width, h: height, dpr };
        setSizeVersion((v) => v + 1);
      }
    };

    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      updateSize(rect.width, rect.height);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        updateSize(width, height);
      }
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h, dpr } = sizeRef.current;
    if (w <= 0 || h <= 0) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!activity || !activity.slots_15m || activity.slots_15m.length === 0) {
      ctx.restore();
      return;
    }

    const currentX = Math.max(0, Math.min(w, (currentSecInDay / 86400) * w));

    // 15分刻みの明確なバーグラフ（全96スロットを一貫して描画）
    const slots96 = activity.slots_15m;
    const slot96W = w / 96;
    for (let i = 0; i < 96; i++) {
      const xStart = i * slot96W;
      const xCenter = xStart + slot96W / 2;
      const intensity = slots96[i] || 0;
      const barH = Math.max(1.5, intensity * (h - 2));
      const barW = Math.max(1, slot96W - 1);
      const yTop = h - barH;

      const isPast = xCenter <= currentX;
      if (isPast) {
        // 再生済み（過去）: 鮮やかな不透明バー
        if (intensity >= 0.7) {
          ctx.fillStyle = "rgba(245, 158, 11, 0.9)"; // 高活動: アンバー
        } else if (intensity >= 0.35) {
          ctx.fillStyle = "rgba(56, 189, 248, 0.85)"; // 中活動: シアン
        } else {
          ctx.fillStyle = "rgba(148, 163, 184, 0.45)"; // 低活動: スレート
        }
      } else {
        // 未再生（未来）: 落ち着いた半透明バー（ボラティリティの波形は完全に把握可能）
        if (intensity >= 0.7) {
          ctx.fillStyle = "rgba(245, 158, 11, 0.45)";
        } else if (intensity >= 0.35) {
          ctx.fillStyle = "rgba(56, 189, 248, 0.40)";
        } else {
          ctx.fillStyle = "rgba(148, 163, 184, 0.20)";
        }
      }

      ctx.fillRect(xStart + 0.5, yTop, barW, barH);
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

    ctx.restore();
  }, [activity, currentSecInDay, sizeVersion]);

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
