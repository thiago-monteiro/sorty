// Node 24: resumable, validated HTTP range downloads; no dependencies.
import {
  mkdir,
  stat,
  open,
  rename,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const repo = "ggml-org/SmolVLM-256M-Instruct-GGUF";
const names = [
  "SmolVLM-256M-Instruct-Q8_0.gguf",
  "mmproj-SmolVLM-256M-Instruct-Q8_0.gguf",
];
const root = resolve(".runtime/models");
const concurrency = Math.min(
  16,
  Math.max(1, Number(process.env.DOWNLOAD_CONCURRENCY || 16)),
);
const started = Date.now();
const deadline = started + Number(process.env.DOWNLOAD_SECONDS || 360) * 1000;
const signal = () =>
  AbortSignal.timeout(Math.max(1, Math.min(120000, deadline - Date.now())));
const sizeOf = async (p) => (await stat(p).catch(() => ({ size: 0 }))).size;
const sha256 = async (p) => {
  const h = createHash("sha256");
  for await (const b of createReadStream(p)) h.update(b);
  return h.digest("hex");
};
await mkdir(root, { recursive: true });
const response = await fetch(
  `https://huggingface.co/api/models/${repo}/tree/main`,
  { signal: signal() },
);
if (!response.ok) throw new Error(`HF tree: ${response.status}`);
const tree = await response.json();
const jobs = [];
let downloaded = 0;
const files = [];
for (const name of names) {
  const metadata = tree.find((f) => f.path === name);
  if (!metadata?.lfs?.oid || !metadata.size)
    throw new Error(`Missing LFS metadata: ${name}`);
  const target = join(root, name);
  if (
    (await sizeOf(target)) === metadata.size &&
    (await sha256(target)) === metadata.lfs.oid
  )
    continue;
  const dir = join(root, "chunks", metadata.lfs.oid);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );
  const redirect = await fetch(
    `https://huggingface.co/${repo}/resolve/main/${name}`,
    { redirect: "manual", signal: signal() },
  );
  const url = redirect.headers.get("location");
  await redirect.body?.cancel();
  if (redirect.status !== 302 || !url)
    throw new Error(`Expected CDN redirect for ${name}: ${redirect.status}`);
  const chunks = [];
  for (let start = 0; start < metadata.size; start += 4 * 1024 * 1024) {
    const end = Math.min(metadata.size - 1, start + 4 * 1024 * 1024 - 1);
    const path = join(dir, `${start}-${end}.chunk`);
    chunks.push(path);
    // Existing curl .part files are deliberately preserved.
    if ((await sizeOf(path)) !== end - start + 1)
      jobs.push({ url, start, end, path, total: metadata.size, name });
  }
  files.push({ target, chunks, metadata });
}
let failures = 0;
// Interleave files so a slow model CDN object cannot starve the projector.
jobs.sort((a, b) => a.start - b.start);
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (jobs.length && Date.now() < deadline) {
      const job = jobs.shift();
      const temp = `${job.path}.partial`;
      try {
        // Only our hash-addressed range partials are resumable, never the old curl .part files.
        const prior = await sizeOf(temp);
        if (prior > job.end - job.start + 1)
          throw new Error(`Oversized partial: ${temp}`);
        if (prior === job.end - job.start + 1) {
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
        console.log(
          `Validated range headers: ${job.name} ${rangeStart}-${job.end}`,
        );
        let received = prior;
        try {
          for await (const data of r.body) {
            if (received + data.length > job.end - job.start + 1)
              throw new Error("Response exceeds requested chunk size");
            await handle.writeFile(data);
            received += data.length;
            downloaded += data.length;
          }
        } finally {
          await handle.close();
        }
        const size = await sizeOf(temp);
        if (size !== job.end - job.start + 1)
          throw new Error(`Short chunk: ${size}`);
        await rename(temp, job.path);
        console.log(
          JSON.stringify({
            file: job.name,
            start: job.start,
            bytes: size,
            downloaded,
            seconds: (Date.now() - started) / 1000,
            mibPerSecond:
              downloaded / 1048576 / ((Date.now() - started) / 1000),
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
for (const { target, chunks, metadata } of files) {
  if (
    (await Promise.all(chunks.map(sizeOf))).reduce((a, b) => a + b, 0) !==
    metadata.size
  ) {
    complete = false;
    continue;
  }
  const assembled = `${target}.assembling`;
  const handle = await open(assembled, "w");
  try {
    for (const chunk of chunks) {
      const data = await readFile(chunk);
      await handle.writeFile(data);
    }
  } finally {
    await handle.close();
  }
  const hash = await sha256(assembled);
  if (hash !== metadata.lfs.oid)
    throw new Error(
      `SHA256 mismatch: ${target}; retained chunks for inspection`,
    );
  await rename(assembled, target);
  console.log(`SHA256 verified ${metadata.path}: ${hash}`);
}
console.log(
  JSON.stringify({
    complete,
    downloaded,
    failures,
    seconds: (Date.now() - started) / 1000,
    remainingChunks: jobs.length,
  }),
);
if (!complete) process.exitCode = 1;
