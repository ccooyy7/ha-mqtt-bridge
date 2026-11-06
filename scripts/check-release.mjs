import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([".git", "node_modules", "dist", "coverage"]);
const blockedDirs = new Set(["data", "private", "archives"]);
const failures = [];
const files = [];
async function walk(relative = "") {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) { failures.push(`${file}: symbolic links are not release inputs`); continue; }
    if (entry.isDirectory()) {
      if (ignored.has(entry.name)) continue;
      if (blockedDirs.has(entry.name)) { failures.push(`${file}: private directory`); continue; }
      await walk(file);
    } else files.push(file);
  }
}
await walk();
const patterns = [
  ["IPv4 address", /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ["local user path", /(?<![A-Za-z0-9])\/(?:Users|home)\/[^\s/]+\//],
  ["JWT-shaped value", /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["embedded credential", /["'](?:password|access_token|token)["']\s*:\s*["'](?!YOUR_|REPLACE_|["'])[A-Za-z0-9_./+=-]{4,}["']/i]
];
for (const file of files) {
  const name = path.basename(file);
  if (name === ".DS_Store" || /^\.env(?:\.|$)/.test(name) && name !== ".env.example" || /(?:_cred\.json|\.local\.|\.(?:zip|pem|key)$)/.test(name)) {
    failures.push(`${file}: private or binary artifact`);
    continue;
  }
  const source = await readFile(path.join(root, file), "utf8");
  for (const [label, pattern] of patterns) if (pattern.test(source)) failures.push(`${file}: ${label}`);
  if (file.endsWith(".svg") && /<\s*(?:script|foreignObject|metadata|image)\b|\bon\w+\s*=|\b(?:href|src)\s*=\s*["'](?!#)/i.test(source)) {
    failures.push(`${file}: active content, embedded metadata or external asset`);
  }
  if (file.endsWith(".md")) {
    const links = [
      ...Array.from(source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g), match => match[1]),
      ...Array.from(source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g), match => match[1])
    ];
    for (const link of links) {
      if (/^(?:https?:|#)/.test(link)) continue;
      try { await readFile(path.resolve(root, path.dirname(file), link.split("#")[0])); }
      catch { failures.push(`${file}: broken link ${link}`); }
    }
  }
}
const flow = JSON.parse(await readFile(path.join(root, "flows/ha-mqtt-bridge.json"), "utf8"));
const configSource = await readFile(path.join(root, "config/gateway.config.js"), "utf8");
assert((await readFile(path.join(root, "README.md"), "utf8")).includes('<a href="README.en.md">English</a>'));
assert((await readFile(path.join(root, "README.en.md"), "utf8")).includes('<a href="README.md">简体中文</a>'));
assert.equal(flow.find(n => n.name === "Gateway config").func, configSource);
let config;
new Function("flow", "node", configSource)({ set: (_, value) => { config = value; } }, { status() {} });
assert.equal(config.exposureMode, "manual");
assert.equal(config.topicMode, "entity_id");
assert.deepEqual(config.entities, []);
assert.equal(flow.find(n => n.type === "mqtt-broker").clientid, "");
assert(!flow.some(n => n.credentials));
assert.equal(JSON.parse(await readFile(path.join(root, "package.json"))).license, "Apache-2.0");
assert((await readFile(path.join(root, "LICENSE"), "utf8")).includes("Version 2.0, January 2004"));
if (failures.length) throw new Error(failures.join("\n"));
console.log(`Release checks passed: ${files.length} files, neutral defaults, no detected credentials or local addresses.`);
