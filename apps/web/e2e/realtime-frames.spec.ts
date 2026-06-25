import { expect, test } from "@playwright/test";

import { parseWireFrame } from "../src/lib/realtime-frames";

test("parseWireFrame rejects malformed websocket messages", () => {
  expect(parseWireFrame("{")).toBeNull();
  expect(parseWireFrame(new ArrayBuffer(0))).toBeNull();
  expect(parseWireFrame(JSON.stringify(["ready"]))).toBeNull();
  expect(parseWireFrame(JSON.stringify({ type: "unknown" }))).toBeNull();
});

test("parseWireFrame validates known frame fields", () => {
  const frame = parseWireFrame(
    JSON.stringify({
      type: "caption",
      lang: "es",
      payload: "Hola",
      is_final: true,
      count: "3",
      code: 4002,
      reason: 42,
    }),
  );

  expect(frame?.type).toBe("caption");
  expect(frame?.lang).toBe("es");
  expect(frame?.payload).toBe("Hola");
  expect(frame?.is_final).toBe(true);
  expect(frame?.count).toBeUndefined();
  expect(frame?.code).toBe(4002);
  expect(frame?.reason).toBeUndefined();
});
