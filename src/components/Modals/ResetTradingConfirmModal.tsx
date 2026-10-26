import React from "react";
import { ResetSettingsConfirmModal } from "./ResetSettingsConfirmModal";

export interface ResetTradingConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ResetTradingConfirmModal: React.FC<ResetTradingConfirmModalProps> = React.memo((props) => (
  <ResetSettingsConfirmModal
    {...props}
    title="取引設定のリセット"
    message="取引設定をデフォルト値にリセットしますか？"
  />
));
