import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in window:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "16px",
          color: "#f87171",
          background: "#12141a",
          height: "100vh",
          boxSizing: "border-box",
          fontFamily: "monospace",
          fontSize: "12px",
          overflow: "auto"
        }}>
          <h3 style={{ color: "#ef4444", margin: "0 0 8px 0" }}>
            ⚠️ {this.props.fallbackTitle || "エラーが発生しました"}
          </h3>
          <p style={{ color: "#e2e8f0", margin: "0 0 8px 0" }}>
            {this.state.error?.message || "不明なエラー"}
          </p>
          <pre style={{ color: "#94a3b8", fontSize: "11px", whiteSpace: "pre-wrap" }}>
            {this.state.error?.stack}
          </pre>
          <button
            type="button"
            style={{
              marginTop: "12px",
              padding: "6px 14px",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer"
            }}
            onClick={() => window.location.reload()}
          >
            画面を再読み込み
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
