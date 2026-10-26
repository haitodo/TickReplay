import React from "react";
import { ResetSettingsConfirmModal } from "./ResetSettingsConfirmModal";

export interface ResetReplayConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ResetReplayConfirmModal: React.FC<ResetReplayConfirmModalProps> = React.memo((props) => (
  <ResetSettingsConfirmModal
    {...props}
    title="リプレイ設定のリセット"
    message="リプレイ設定をデフォルト値にリセットしますか？"
  />
));
