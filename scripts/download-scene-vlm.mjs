// Resumable, SHA256-verified range download for the local scene VLM.
// Node 24+, no dependencies. Reuses the chunking pattern from download-model.mjs.
// Target: official Qwen Qwen3-VL-2B-Instruct Q4_K_M + mmproj Q8_0 (~1.55 GB).
import { mkdir, stat, open, rename, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const repo = process.env.SCENE_VLM_REPO || "Qwen/Qwen3-VL-2B-Instruct-GGUF";
const names = (
  process.env.SCENE_VLM_FILES ||
  "Qwen3VL-2B-Instruct-Q4_K_M.gguf,mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const root = resolve(process.env.SCENE_VLM_DIR || ".runtime/models/scene-vlm");
const concurrency = Math.min(
  16,
  Math.max(1, Number(process.env.DOWNLOAD_CONCURRENCY || 8)),
);
const started = Date.now();
const deadline = started + Number(process.env.DOWNLOAD_SECONDS || 360) * 1000;
const chunkSize = Number(process.env.DOWNLOAD_CHUNK_MIB || 4) * 1024 * 1024;
const signal = () =>
  AbortSignal.timeout(Math.max(1, Math.min(120000, deadline - Date.now())));
const sizeOf = async (p) => (await stat(p).catch(() => ({ size: 0 }))).size;
const sha256 = async (p) => {
  const h = createHash("sha256");
  for await (const b of createReadStream(p)) h.update(b);
  return h.digest("hex");
};

await mkdir(root, { recursive: true });
const response = await fetch(`https://huggingface.co/api/models/${repo}/tree/main`, {
  signal: signal(),
});
if (!response.ok) throw new Error(`HF tree: ${response.status}`);
const tree = await response.json();
const jobs = [];
const files = [];
let downloaded = 0;
let reused = 0;

for (const name of names) {
  const metadata = tree.find((f) => f.path === name);
  if (!metadata?.lfs?.oid || !metadata.size)
    throw new Error(`Missing LFS metadata: ${name}`);
  const target = join(root, name);
  if (
    (await sizeOf(target)) === metadata.size &&
    (await sha256(target)) === metadata.lfs.oid
  ) {
    console.log(`Already verified: ${name}`);
    reused += metadata.size;
    files.push({ target, chunks: [], metadata, done: true });
    continue;
  }
  const dir = join(root, "chunks", metadata.lfs.oid);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "metadata.json"), JSON.stringify(metadata, null, 2));
  const redirect = await fetch(
    `https://huggingface.co/${repo}/resolve/main/${name}`,
    { redirect: "manual", signal: signal() },
  );
  const url = redirect.headers.get("location");
  await redirect.body?.cancel();
  if (redirect.status !== 302 || !url)
    throw new Error(`Expected CDN redirect for ${name}: ${redirect.status}`);
  const chunks = [];
  for (let start = 0; start < metadata.size; start += chunkSize) {
    const end = Math.min(metadata.size - 1, start + chunkSize - 1);
    const path = join(dir, `${start}-${end}.chunk`);
    chunks.push(path);
    if ((await sizeOf(path)) !== end - start + 1)
      jobs.push({ url, start, end, path, total: metadata.size, name });
  }
  files.push({ target, chunks, metadata, done: false });
}

jobs.sort((a, b) => a.start - b.start);
let failures = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (jobs.length && Date.now() < deadline) {
      const job = jobs.shift();
      const temp = `${job.path}.partial`;
      const expectedBytes = job.end - job.start + 1;
      try {
        const prior = await sizeOf(temp);
        if (prior > expectedBytes) throw new Error(`Oversized partial: ${temp}`);
        if (prior === expectedBytes) {
          await rename(temp, job.path);
          continue;
        }
        const rangeStart = job.start + prior;
        const r = await fetch(job.url, {
          headers: {
            Range: `bytes=${rangeStart}-${job.end}`,
            "Accept-Encoding": "identity",
          },
          signal: signal(),
        });
        const expected = `bytes ${rangeStart}-${job.end}/${job.total}`;
        if (r.status !== 206 || r.headers.get("content-range") !== expected) {
          await r.body?.cancel();
          throw new Error(
            `Invalid range response: ${r.status} ${r.headers.get("content-range")}; expected ${expected}`,
          );
        }
        const handle = await open(temp, "a");
        let received = prior;
        try {
          for await (const data of r.body) {
            if (received + data.length > expectedBytes)
              throw new Error("Response exceeds requested chunk size");
            await handle.writeFile(data);
            received += data.length;
            downloaded += data.length;
          }
        } finally {
          await handle.close();
        }
        const size = await sizeOf(temp);
        if (size !== expectedBytes) throw new Error(`Short chunk: ${size}`);
        await rename(temp, job.path);
        const secs = (Date.now() - started) / 1000;
        console.log(
          JSON.stringify({
            file: job.name,
            start: job.start,
            bytes: size,
            downloaded,
            seconds: Number(secs.toFixed(1)),
            mibPerSecond: Number((downloaded / 1048576 / secs).toFixed(2)),
          }),
        );
      } catch (error) {
        failures++;
        console.error(`${job.name} range ${job.start}: ${error.message}`);
        if (Date.now() < deadline) jobs.push(job);
      }
    }
  }),
);

let complete = true;
for (const entry of files) {
  if (entry.done) continue;
  const { target, chunks, metadata } = entry;
  const got = (await Promise.all(chunks.map(sizeOf))).reduce((a, b) => a + b, 0);
  if (got !== metadata.size) {
    complete = false;
    console.error(
      `Incomplete: ${metadata.path} ${got}/${metadata.size} bytes; chunks retained for resume`,
    );
    continue;
  }
  const assembled = `${target}.assembling`;
  const handle = await open(assembled, "w");
  try {
    for (const chunk of chunks) await handle.writeFile(await readFile(chunk));
  } finally {
    await handle.close();
  }
  const hash = await sha256(assembled);
  if (hash !== metadata.lfs.oid) {
    await rename(assembled, `${assembled}.bad`);
    throw new Error(`SHA256 mismatch: ${target}; retained for inspection`);
  }
  await rename(assembled, target);
  console.log(`SHA256 verified ${metadata.path}: ${hash}`);
}

const manifest = {
  repo,
  root,
  files: files.map(({ metadata, target }) => ({
    path: metadata.path,
    target,
    bytes: metadata.size,
    sha256: metadata.lfs?.oid,
  })),
  complete,
  downloadedBytes: downloaded,
  reusedBytes: reused,
  failures,
  seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  remainingChunks: jobs.length,
};
await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
if (!complete) process.exitCode = 1;
