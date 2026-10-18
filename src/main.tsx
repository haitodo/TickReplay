import React from "react";
import ReactDOM from "react-dom/client";
// Google Fonts に依存せず、CSP/オフライン環境でも同じ字形になるようローカル同梱する。
import "@fontsource-variable/inter";
// outlined のみを読み込む。パッケージ既定のエントリ (index.css) は outlined / rounded / sharp の
// 3書体すべてをバンドルしてしまうが、実際に使っているのは .material-symbols-outlined だけ。
import "material-symbols/outlined.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
