import React, { useState, useRef, useEffect } from "react";
import type { SymbolItem } from "../types/symbol";
import { isReplaySymbol } from "../utils/symbolUtils";
import { parseSynchronizedSymbols } from "../domain/synchronizedSymbols";

interface SymbolTagInputProps {
  value: string; // カンマ区切りの文字列 (例: "EURUSD,GBPUSD,USDCHF")
  onChange: (value: string) => void;
  availableSymbols: (SymbolItem | string)[];
  placeholder?: string;
  maxTags?: number;
}

export const SymbolTagInput: React.FC<SymbolTagInputProps> = ({
  value,
  onChange,
  availableSymbols,
  maxTags = Number.POSITIVE_INFINITY,
  placeholder = "銘柄を追加... (例: EURUSD)"
}) => {
  const [inputText, setInputText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [limitError, setLimitError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 文字列を分解してタグ配列に
  const tags = parseSynchronizedSymbols(value);

  const symbolNames = availableSymbols
    .map(s => typeof s === "string" ? s : s.name)
    .filter(name => !isReplaySymbol(name));

  const updateTags = (newTags: string[]) => {
    onChange(newTags.join(","));
  };

  const handleAddTag = (symbolToAdd: string) => {
    const input = symbolToAdd.trim();
    const clean = symbolNames.find((symbol) => symbol.toUpperCase() === input.toUpperCase()) ?? input;
    if (clean && !tags.some((tag) => tag.toUpperCase() === clean.toUpperCase())) {
      if (tags.length >= maxTags) {
        setLimitError(true);
        return;
      }
      updateTags([...tags, clean]);
    }
    setLimitError(false);
    setInputText("");
    setIsOpen(false);
  };

  const handleRemoveTag = (indexToRemove: number) => {
    setLimitError(false);
    updateTags(tags.filter((_, idx) => idx !== indexToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (inputText.trim()) {
        handleAddTag(inputText);
      }
    } else if (e.key === "Backspace" && !inputText && tags.length > 0) {
      handleRemoveTag(tags.length - 1);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 候補フィルタリング
  const searchUpper = inputText.trim().toUpperCase();
  const suggestions = Array.from(new Set(symbolNames))
    .filter(s => !tags.some((tag) => tag.toUpperCase() === s.toUpperCase()))
    .filter(s => s.toUpperCase().includes(searchUpper));

  return (
    <div className="symbol-tag-input-container" ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <div
        className="pro-input"
        onClick={() => {
          setIsOpen(true);
          inputRef.current?.focus();
        }}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "3px",
          minHeight: "26px",
          padding: "2px 6px",
          cursor: "text",
          boxSizing: "border-box"
        }}
      >
        {tags.map((tag, idx) => (
          <span
            key={tag + idx}
            className="symbol-tag-pill"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "3px",
              padding: "1px 6px",
              fontSize: "10.5px",
              fontWeight: 600,
              backgroundColor: "var(--surface-container-high, rgba(255,255,255,0.1))",
              color: "var(--on-surface)",
              border: "1px solid var(--outline-variant)",
              borderRadius: "3px",
              lineHeight: "16px",
              height: "18px",
              boxSizing: "border-box"
            }}
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveTag(idx);
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--on-surface-variant)",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                fontSize: "12px",
                lineHeight: 1
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>close</span>
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsFocused(true);
            setIsOpen(true);
          }}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : ""}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            color: "inherit",
            fontSize: "11px",
            flex: 1,
            minWidth: tags.length === 0 ? "100%" : isFocused || inputText ? "50px" : "10px",
            height: "18px",
            lineHeight: "18px",
            padding: 0
          }}
        />
      </div>

      {limitError && (
        <div role="alert" style={{ color: "var(--error)", fontSize: "10px", marginTop: "3px" }}>
          同期通貨は最大{maxTags}銘柄です。追加する前に他の銘柄を削除してください。
        </div>
      )}

      {isOpen && suggestions.length > 0 && (
        <ul
          className="custom-select-dropdown"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 1000,
            maxHeight: "180px",
            overflowY: "auto",
            margin: "4px 0 0 0",
            padding: "4px 0",
            backgroundColor: "var(--surface-container-high)",
            border: "1px solid var(--outline-variant)",
            borderRadius: "var(--radius-sm, 6px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            listStyle: "none"
          }}
        >
          {suggestions.map((sym) => (
            <li
              key={sym}
              onClick={() => handleAddTag(sym)}
              style={{
                padding: "6px 12px",
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
              className="custom-select-option"
            >
              <span>{sym}</span>
              <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "var(--on-surface-variant)" }}>add</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
