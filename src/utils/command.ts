import { invoke } from "@tauri-apps/api/core";

/** JSON command accepted by the replay EA through the Tauri IPC bridge. */
export type ReplayCommand = {
  command: string;
  [key: string]: unknown;
};

/** Sends one replay command, keeping serialization in a single boundary. */
export function sendReplayCommand(command: ReplayCommand): Promise<void> {
  return invoke<void>("send_command", {
    commandJson: JSON.stringify(command),
  });
}
