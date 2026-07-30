# カスタムシンボル・ティックリプレイ検証システム - リモコンアプリ (Tauri)

本ディレクトリは、MetaTrader 5 (MT5) でティックデータの再生・巻き戻し検証を行うためのネイティブ操作UI（Tauri + React + TypeScript）のソースコードです。

---

## 💻 動作環境
* **OS**: Windows 10 / 11 (64bit)
* **MetaTrader 5**: インストールおよび稼働していること

---

## 🛠️ Windows ビルド環境構築手順

本アプリは Rust と Node.js (Vite) で構築されているため、Windows 上でビルドを行うためには以下の開発環境のセットアップが必要です。

### 1. Node.js のインストール
フロントエンドのビルドおよびパッケージ管理に使用します。
1. [Node.js 公式サイト (https://nodejs.org/ja)](https://nodejs.org/) にアクセスします。
2. **LTS（推奨版）**（例: `v18` または `v20` 以降）のインストーラーをダウンロードして実行します。
3. インストーラーの指示に従って完了させます（PATHへの追加は自動で行われます）。

### 2. Microsoft C++ Build Tools (MSVC) のインストール
Rust が Windows ネイティブのバイナリをコンパイルするために必要なコンパイラです。
1. [Visual Studio Downloads (https://visualstudio.microsoft.com/ja/downloads/)](https://visualstudio.microsoft.com/ja/downloads/) または直接 [Build Tools for Visual Studio 2022](https://visualstudio.microsoft.com/ja/visual-studio-software-services/) からインストーラーをダウンロードします。
2. インストーラーを起動し、ワークロードの選択画面で **「C++ によるデスクトップ開発」(Desktop development with C++)** にチェックを入れます。
3. 画面右側の「インストールの詳細」で、以下のコンポーネントが選択されていることを確認します：
   * **MSVC v143 - VS 2022 C++ x64/x86 ビルドツール**（最新版）
   * **Windows 11 SDK**（または Windows 10 SDK）
4. インストールを実行し、完了したら PC を再起動することを推奨します。

### 3. Rust (rustup) のインストール
1. [Rust 公式インストールページ (https://rustup.rs/)](https://rustup.rs/) から `rustup-init.exe` (64-bit) をダウンロードして実行します。
2. コマンドプロンプト画面が開くので、デフォルト設定（通常は `1) Proceed with installation (default)`）を選択するために `1` を入力して `Enter` を押します。
3. インストール完了後、コマンドプロンプトを閉じて開き直します。

### 4. 環境の動作確認
新しくコマンドプロンプトまたは PowerShell を起動し、以下のコマンドが正常に出力されるか確認してください。

```cmd
# Node.js と npm のバージョン確認
node -v
npm -v

# Rust と Cargo のバージョン確認
rustc --version
cargo --version
```

それぞれバージョン番号が表示されれば、環境構築は完了です。

---

## 🚀 ビルドおよび開発コマンド手順

コマンドプロンプト、PowerShell、または VS Code の統合ターミナルで、本ディレクトリ（`TickReplayControllerOnNativeApp`）を開いて実行します。

### 1. 依存関係のインストール
最初に一度だけ実行し、必要なパッケージをダウンロードします。
```bash
npm install
```

### 2. 開発モードでの起動 (ホットリロード対応)
フロントエンドおよびバックエンドをデバッグ実行し、アプリ画面を起動します。コード変更が即座に反映されます。
```bash
npm run tauri dev
```
> [!NOTE]
> 初回起動時は、Rustパッケージのダウンロードおよびコンパイルが走るため、数分かかる場合があります。

### 3. リリースビルドの実行 (Windows 用バイナリ生成)
本番用の最適化された実行ファイルおよびインストーラーをビルドします。
```bash
npm run tauri build
```
ビルドが成功すると、以下のパスに出力ファイルが生成されます：

* **インストーラーファイル (.exe)**:
  `src-tauri/target/release/bundle/nsis/TickReplay_0.1.0_x64-setup.exe`
* **実行ファイル (.exe)**:
  `src-tauri/target/release/TickReplay.exe`

配布する際は、生成された `.exe` インストーラーをそのまま配布して利用できます。

---

## ⚠️ トラブルシューティング (Windows ビルド時のエラー)

### Q. 「`link.exe` が見つからない」または「`MSVC` コンパイラが必要」というエラーが出る
* **原因**: Microsoft C++ Build Tools が正しくインストールされていないか、PATHが通っていません。
* **解決策**: 再度 Visual Studio Installer を開き、「C++ によるデスクトップ開発」ワークロードがインストールされているか確認してください。Windows SDK も必須です。

### Q. `xdg-open` 関連のエラーがビルド中に発生する
* **原因**: Linux/WSL 環境下でビルドしようとした場合、あるいは設定の不整合によるものです。
* **解決策**: Windows 本体の環境（通常のコマンドプロンプトや PowerShell）でビルドを行ってください。WSL内からWindows向けビルドを行う場合は、クロスコンパイル設定が必要になりますが、Windows上で直接実行することを強く推奨します。

---