import React from "react";
import ReactDOM from "react-dom/client";
// outlined のみを読み込む。パッケージ既定のエントリ (index.css) は outlined / rounded / sharp の
// 3書体すべてをバンドルしてしまうが、実際に使っているのは .material-symbols-outlined だけ。
import "material-symbols/outlined.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
