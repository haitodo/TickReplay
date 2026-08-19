import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export interface HelpTooltipProps {
  title?: string;
  content: React.ReactNode;
  tip?: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  icon?: string;
  iconSize?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const HelpTooltip: React.FC<HelpTooltipProps> = ({
  title,
  content,
  tip,
  placement = "auto",
  icon = "help",
  iconSize = 13,
  className = "",
  style,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; actualPlacement: string }>({
    top: 0,
    left: 0,
    actualPlacement: "top"
  });

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const tooltipEl = tooltipRef.current;
    const tooltipWidth = tooltipEl ? tooltipEl.offsetWidth : 280;
    const tooltipHeight = tooltipEl ? tooltipEl.offsetHeight : 120;
    const spacing = 8;
    const padding = 12;

    let targetPlacement = placement;
    if (targetPlacement === "auto") {
      // 画面上部に十分なスペースがあるか判定（デフォルトは上）
      if (rect.top - tooltipHeight - spacing < padding) {
        targetPlacement = "bottom";
      } else {
        targetPlacement = "top";
      }
    }

    let top = 0;
    let left = 0;

    if (targetPlacement === "top") {
      top = rect.top - tooltipHeight - spacing;
      left = rect.left + rect.width / 2 - tooltipWidth / 2;
    } else if (targetPlacement === "bottom") {
      top = rect.bottom + spacing;
      left = rect.left + rect.width / 2 - tooltipWidth / 2;
    } else if (targetPlacement === "left") {
      top = rect.top + rect.height / 2 - tooltipHeight / 2;
      left = rect.left - tooltipWidth - spacing;
    } else if (targetPlacement === "right") {
      top = rect.top + rect.height / 2 - tooltipHeight / 2;
      left = rect.right + spacing;
    }

    // 画面外はみ出し防止 (水平方向)
    if (left < padding) {
      left = padding;
    } else if (left + tooltipWidth > window.innerWidth - padding) {
      left = window.innerWidth - padding - tooltipWidth;
    }

    // 画面外はみ出し防止 (垂直方向)
    if (top < padding) {
      top = padding;
    } else if (top + tooltipHeight > window.innerHeight - padding) {
      top = window.innerHeight - padding - tooltipHeight;
    }

    setCoords({
      top: Math.round(top),
      left: Math.round(left),
      actualPlacement: targetPlacement
    });
  }, [placement]);

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsVisible(false);
    }, 150);
  };

  const handleTooltipMouseEnter = () => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const handleTooltipMouseLeave = () => {
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsVisible(false);
    }, 150);
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsVisible((prev) => !prev);
  };

  useEffect(() => {
    if (isVisible) {
      updatePosition();
      const handleScrollOrResize = () => {
        updatePosition();
      };
      window.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);
      return () => {
        window.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
      };
    }
  }, [isVisible, updatePosition]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isVisible) {
        setIsVisible(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, [isVisible]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`help-tooltip-trigger ${className}`}
        style={style}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleToggleClick}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
        aria-label={title || "ヘルプ・説明"}
        tabIndex={0}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: `${iconSize}px` }}
        >
          {icon}
        </span>
      </button>

      {isVisible &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tooltipRef}
            className="help-tooltip-popover"
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`
            }}
            onMouseEnter={handleTooltipMouseEnter}
            onMouseLeave={handleTooltipMouseLeave}
            role="tooltip"
          >
            {title && (
              <div className="help-tooltip-header">
                <span className="material-symbols-outlined help-tooltip-header-icon">info</span>
                <span className="help-tooltip-title">{title}</span>
              </div>
            )}
            <div className="help-tooltip-body">{content}</div>
            {tip && (
              <div className="help-tooltip-tip">
                <span className="material-symbols-outlined help-tooltip-tip-icon">lightbulb</span>
                <div className="help-tooltip-tip-text">{tip}</div>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
};
