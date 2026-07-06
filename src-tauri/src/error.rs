use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("I/Oエラー: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSONエラー: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Tauriエラー: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("ショートカットエラー: {0}")]
    Shortcut(String),

    #[error("設定エラー: {0}")]
    Config(String),

    #[error("無効なプロファイル名です: {0}")]
    InvalidProfile(String),

    #[error("MT5エラー: {0}")]
    Mt5(String),
}

// Tauriのコマンドハンドラーからエラーを返却した際、自動的にシリアライズされて
// フロントエンドのPromiseのreject値に渡るようにする。
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
