import type { PcmPlayerFailureReason } from "@/lib/realtime-audio";
import type { CaptionApplyFailureReason } from "@/lib/realtime-captions";
import {
  INVALID_SERVER_FRAME_CLOSE_CODE,
  INVALID_SERVER_FRAME_CLOSE_REASON_PREFIX,
  INVALID_SERVER_MESSAGE,
} from "@/lib/realtime-constants";
import type { InvalidWireFrameReason } from "@/lib/realtime-frames";

export { INVALID_SERVER_MESSAGE };

type InvalidServerMessageReason =
  | InvalidWireFrameReason
  | PcmPlayerFailureReason
  | CaptionApplyFailureReason
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
      `${INVALID_SERVER_FRAME_CLOSE_REASON_PREFIX}${reason}`,
    );
  } catch {
    try {
      ws.close();
    } catch {
      /* socket already gone */
    }
  }
}
