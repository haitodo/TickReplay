import { invoke } from "@tauri-apps/api/core";
import { COMMANDS } from "../constants/commands";
import type { CoreStatusSnapshot, ExecutionAuditRecord, LatencyModel, SlippageModel } from "../types/replay";

/** JSON command accepted by the replay EA through the Tauri IPC bridge. */
export type ReplayCommand = {
  command: string;
  [key: string]: unknown;
};

/** Sends one replay command, keeping serialization in a single boundary. */
export function sendReplayCommand(command: ReplayCommand): Promise<void> {
  return invoke<void>(COMMANDS.sendCommand, {
    commandJson: JSON.stringify(command),
  });
}

/** Core v2 スナップショット取得 */
export function getCoreV2Status(): Promise<CoreStatusSnapshot | null> {
  return invoke<CoreStatusSnapshot | null>(COMMANDS.getCoreV2Status);
}

/** Core v2 有効化トグル */
export function setUseCoreV2(enabled: boolean): Promise<void> {
  return invoke<void>(COMMANDS.setUseCoreV2, { enabled });
}

/** Core v2 が有効かどうか */
export function isUseCoreV2(): Promise<boolean> {
  return invoke<boolean>(COMMANDS.isUseCoreV2);
}

/** 約定監査ログの取得 */
export function getExecutionAuditLog(): Promise<ExecutionAuditRecord[]> {
  return invoke<ExecutionAuditRecord[]>(COMMANDS.getExecutionAuditLog);
}

/** 遅延モデル・スリッページモデルの設定 */
export function setExecutionModels(
  latencyModel?: LatencyModel,
  slippageModel?: SlippageModel
): Promise<void> {
  return invoke<void>(COMMANDS.setExecutionModels, {
    latencyModel,
    slippageModel,
  });
}
