import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import fs from "fs";
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/NEXT_PUBLIC_CONVEX_URL=(\S+)/)[1];
const c = new ConvexHttpClient(url);
const projectId = process.argv[2];
const data = await c.query(anyApi.projects.get, { projectId });
const vid = data.versions[data.versions.length - 1]._id;
const files = await c.query(anyApi.files.listByVersion, { versionId: vid });
let realEmoji = false, mojibake = false, sample = "";
for (const f of files) {
  const hex = Buffer.from(f.contents, "utf8").toString("hex");
  if (hex.includes("f09f")) { realEmoji = true; const l = f.contents.split("\n").find((l) => /\p{Emoji}/u.test(l)); if (l && !sample) sample = f.path + ": " + l.trim().slice(0, 70); }
  if (/e9a683|e686a2/.test(hex)) { mojibake = true; const l = f.contents.split("\n").find((l) => /馃|憢|路/.test(l)); if (l) sample = "MOJI " + f.path + ": " + l.trim().slice(0, 70); }
}
console.log("HTTP-client read of stored data:");
console.log("  real emoji bytes present:", realEmoji);
console.log("  mojibake present:", mojibake);
console.log("  sample:", sample);
