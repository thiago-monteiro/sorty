import {
  mkdir,
  readFile,
  writeFile,
  stat,
  open,
  rename,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "../.runtime");
await mkdir(root, { recursive: true });
const metaPath = join(root, "cloudflared-release.json");
let release;
try {
  release = JSON.parse(await readFile(metaPath, "utf8"));
} catch {
  const r = await fetch(
    "https://api.github.com/repos/cloudflare/cloudflared/releases/latest",
  );
  if (!r.ok) throw Error(`Release metadata: ${r.status}`);
  release = await r.json();
  await writeFile(metaPath, JSON.stringify(release, null, 2));
}
if (
  !release.html_url?.startsWith(
    "https://github.com/cloudflare/cloudflared/releases/",
  )
)
  throw Error("Unexpected release origin");
const asset = release.assets.find(
  (a) => a.name === "cloudflared-windows-amd64.exe",
);
if (
  !asset?.digest?.match(/^sha256:[a-f0-9]{64}$/) ||
  !asset.browser_download_url.startsWith(
    "https://github.com/cloudflare/cloudflared/releases/download/",
  )
)
  throw Error("Missing official SHA256 or download URL");
const hash = asset.digest.slice(7),
  target = join(root, asset.name);
const size = async (p) => (await stat(p).catch(() => ({ size: 0 }))).size;
const sha = async (p) => {
  const h = createHash("sha256");
  for await (const b of createReadStream(p)) h.update(b);
  return h.digest("hex");
};
if ((await size(target)) === asset.size && (await sha(target)) === hash) {
  console.log(`SHA256 verified ${target}`);
  process.exit(0);
}
const r = await fetch(asset.browser_download_url, {
  redirect: "manual",
  signal: AbortSignal.timeout(30000),
});
const url = r.headers.get("location");
await r.body?.cancel();
if (!url || r.status !== 302)
  throw Error(`Expected release CDN redirect: ${r.status}`);
const dir = join(root, `cloudflared-chunks-${hash}`);
await mkdir(dir, { recursive: true });
const jobs = [],
  chunks = [];
for (let start = 0; start < asset.size; start += 4 * 1024 * 1024) {
  const end = Math.min(asset.size - 1, start + 4 * 1024 * 1024 - 1),
    path = join(dir, `${start}-${end}`);
  chunks.push(path);
  if ((await size(path)) !== end - start + 1) jobs.push({ start, end, path });
}
await Promise.all(
  Array.from({ length: 16 }, async () => {
    while (jobs.length) {
      const j = jobs.shift();
      let done = false;
      for (let retry = 0; retry < 3 && !done; retry++) {
        const temp = j.path + ".partial",
          prior = await size(temp),
          length = j.end - j.start + 1;
        if (prior > length) throw Error("Oversized partial");
        if (prior === length) {
          await rename(temp, j.path);
          done = true;
          break;
        }
        try {
          const start = j.start + prior;
          const response = await fetch(url, {
            headers: {
              Range: `bytes=${start}-${j.end}`,
              "Accept-Encoding": "identity",
            },
            signal: AbortSignal.timeout(120000),
          });
          if (
            response.status !== 206 ||
            response.headers.get("content-range") !==
              `bytes ${start}-${j.end}/${asset.size}`
          ) {
            await response.body?.cancel();
            throw Error(
              `Invalid range ${response.status} ${response.headers.get("content-range")}`,
            );
          }
          const file = await open(temp, "a");
          let received = prior;
          try {
            for await (const data of response.body) {
              received += data.length;
              if (received > length) throw Error("Oversized range");
              await file.writeFile(data);
            }
          } finally {
            await file.close();
          }
          if ((await size(temp)) !== length) throw Error("Short range");
          await rename(temp, j.path);
          done = true;
          console.log(`Downloaded range ${j.start}-${j.end}`);
        } catch (e) {
          if (retry === 2) throw e;
          console.error(e.message);
        }
      }
    }
  }),
);
const assembled = target + ".assembling",
  file = await open(assembled, "w");
try {
  for (const chunk of chunks) await file.writeFile(await readFile(chunk));
} finally {
  await file.close();
}
if ((await sha(assembled)) !== hash)
  throw Error("SHA256 mismatch; preserved download for inspection");
await rename(assembled, target);
console.log(`SHA256 verified ${hash}`);
