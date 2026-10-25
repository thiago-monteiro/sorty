import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index";

async function serve(
  mock: typeof fetch,
  run: (url: string) => Promise<void>,
  timeoutMs?: number,
) {
  const server = createApp({
    fetch: mock,
    model: "test-vision",
    timeoutMs,
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const frame = "data:image/png;base64,aGVsbG8=";
const models = () => Response.json({ data: [{ id: "test-vision" }] });
test("health reports unavailable provider honestly", async () => {
  await serve(
    async () => {
      throw new Error("offline");
    },
    async (url) => {
      const result = await (await fetch(`${url}/api/health`)).json();
      assert.equal(result.ok, true);
      assert.equal(result.engine, "deterministic");
      assert.equal(result.vision.available, false);
      assert.match(result.vision.reason, /unavailable/);
      assert.equal(
        (
          await fetch(`${url}/api/vision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: frame }),
          })
        ).status,
        503,
      );
    },
  );
});
test("validates images and returns unverified observation with both frames", async () => {
  let calls = 0;
  await serve(
    async (input, init) => {
      if (String(input).endsWith("/models")) return models();
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(
        body.messages[0].content.filter(
          (c: { type: string }) => c.type === "image_url",
        ).length,
        2,
      );
      return Response.json({
        choices: [{ message: { content: "A basket is visible." } }],
      });
    },
    async (url) => {
      const post = (body: object) =>
        fetch(`${url}/api/vision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      assert.equal(
        (await post({ image: "https://example.com/photo.png" })).status,
        400,
      );
      assert.equal(
        (
          await post({
            image: `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")}`,
          })
        ).status,
        400,
      );
      const response = await post({ image: frame, beforeImage: frame });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.verified, false);
      assert.equal(result.local, true);
      assert.equal(result.model, "test-vision");
      assert.equal(result.observation, "A basket is visible.");
      assert.equal(calls, 1);
    },
  );
});
test("inference times out and releases concurrency slot", async () => {
  await serve(
    async (input, init) => {
      if (String(input).endsWith("/models")) return models();
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      );
    },
    async (url) => {
      const post = () =>
        fetch(`${url}/api/vision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: frame }),
        });
      assert.equal((await post()).status, 504);
      assert.equal((await post()).status, 504);
    },
    30,
  );
});
