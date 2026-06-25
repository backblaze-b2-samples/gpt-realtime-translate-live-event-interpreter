import type { PcmPlayerFailureReason } from "@/lib/realtime-audio";
import type { InvalidWireFrameReason } from "@/lib/realtime-frames";

export const INVALID_SERVER_MESSAGE = "Received an invalid server message.";

const INVALID_SERVER_FRAME_CLOSE_CODE = 4004;

type InvalidServerMessageReason =
  | InvalidWireFrameReason
  | PcmPlayerFailureReason
  | "audio-playback-failed";

export function closeInvalidServerFrame(
  ws: WebSocket,
  reason: InvalidServerMessageReason,
): void {
  if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
    return;
  }
  try {
    ws.close(
      INVALID_SERVER_FRAME_CLOSE_CODE,
      `invalid-server-frame:${reason}`,
    );
  } catch {
    try {
      ws.close();
    } catch {
      /* socket already gone */
    }
  }
}
