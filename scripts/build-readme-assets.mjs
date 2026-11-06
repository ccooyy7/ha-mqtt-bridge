import { mkdir, readFile, writeFile } from "node:fs/promises";

const assets = new URL("../docs/assets/", import.meta.url);
const flow = JSON.parse(await readFile(new URL("../flows/ha-mqtt-bridge.json", import.meta.url), "utf8"));
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const nodes = flow.filter(node => node.z && node.type !== "comment");
const byId = new Map(nodes.map(node => [node.id, node]));
const names = new Map([
  ["Init gateway config", "Initialize config"],
  ["Discover entities on deploy and every 10 min", "Discover entities"],
  ["Build meta/state/availability messages", "Build discovery messages"],
  ["Normalize discovery MQTT message", "Normalize MQTT"],
  ["Publish discovery messages", "Publish meta / state"],
  ["HA state_changed events", "HA state_changed"],
  ["Build state MQTT messages", "Build state messages"],
  ["Validate command and build service call", "Validate and map command"],
  ["Command input {prefix}/{site}/+/+/set", "MQTT command input"],
  ["Catch HA service errors", "Catch service errors"],
  ["Publish success result", "Publish result: success"],
  ["Publish error result", "Publish result: error"]
]);
const escape = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const width = node => Math.max(126, Math.min(242, (names.get(node.name) || node.name).length * 7 + 40));
const color = type => ({ inject: "#a6bbcf", function: "#f2bd86", "mqtt in": "#d2b2cf", "mqtt out": "#d2b2cf", "api-call-service": "#a1cbe1", "server-events": "#a1cbe1", catch: "#d8c9a4" }[type] || "#ddd");
const edges = [];
for (const node of nodes) {
  for (const [port, targets] of (node.wires || []).entries()) {
    for (const targetId of targets) {
      const target = byId.get(targetId);
      if (!target) continue;
      const x1 = node.x + width(node) / 2;
      const x2 = target.x - width(target) / 2;
      const y1 = node.y + (port - ((node.wires.length || 1) - 1) / 2) * 9;
      const offset = Math.max(35, (x2 - x1) / 2);
      edges.push(`<path d="M${x1},${y1} C${x1 + offset},${y1} ${x2 - offset},${target.y} ${x2},${target.y}"/>`);
    }
  }
}
const layout = `<svg xmlns="http://www.w3.org/2000/svg" width="1460" height="750" viewBox="0 0 1460 750" role="img" aria-labelledby="title desc">
<title id="title">HA MQTT Bridge flow layout</title>
<desc id="desc">Configuration, entity discovery, state synchronization, and commands with responses in the HA MQTT Bridge flow.</desc>
<defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#edf0f3" stroke-width="1"/></pattern></defs>
<rect x="1" y="1" width="1458" height="748" rx="5" fill="#fff" stroke="#d0d7de"/>
<path d="M6 1h1448a5 5 0 0 1 5 5v39H1V6a5 5 0 0 1 5-5" fill="#f6f8fa"/>
<path d="M1 45h1458" stroke="#d0d7de"/>
<g font-family="Arial,sans-serif" font-size="15"><text x="24" y="30" font-weight="600" fill="#9a3032">Node-RED</text><rect x="132" y="12" width="165" height="33" fill="#fff" stroke="#d0d7de"/><text x="147" y="34" fill="#47515c">HA MQTT Bridge</text></g>
<g transform="translate(0 45)">
<rect x="2" y="1" width="1456" height="700" fill="url(#grid)"/>
<g font-family="Arial,sans-serif" font-size="12" fill="#80909a"><text x="38" y="54">CONFIGURATION</text><text x="38" y="174">ENTITY DISCOVERY</text><text x="38" y="309">STATE SYNC</text><text x="38" y="460">COMMANDS &amp; RESULTS</text></g>
<g fill="none" stroke="#b4bdc5" stroke-width="2">${edges.join("")}</g>
${nodes.map(node => {
  const w = width(node);
  const text = names.get(node.name) || node.name;
  return `<g transform="translate(${node.x - w / 2},${node.y - 17})"><rect x="-3" y="12" width="7" height="10" rx="2" fill="#fff" stroke="#a0a6ad"/><rect width="${w}" height="34" rx="4" fill="${color(node.type)}" stroke="#9a9ea5"/><rect x="${w - 4}" y="12" width="7" height="10" rx="2" fill="#fff" stroke="#a0a6ad"/><text x="${w / 2}" y="22" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#30363d">${escape(text)}</text></g>`;
}).join("")}
</g>
</svg>\n`;

const version = escape(pkg.version);
const versionWidth = Math.max(45, pkg.version.length * 7 + 16);
const badgeWidth = 52 + versionWidth;
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="22" viewBox="0 0 ${badgeWidth} 22" role="img" aria-labelledby="title">
<title id="title">Version: ${version}</title>
<rect width="${badgeWidth}" height="22" rx="3" fill="#2781b5"/><path d="M3 0h49v22H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3" fill="#555e68"/>
<g fill="#fff" text-anchor="middle" font-family="Verdana,sans-serif" font-size="10"><text x="26" y="15">version</text><text x="${52 + versionWidth / 2}" y="15">${version}</text></g>
</svg>\n`;

await mkdir(assets, { recursive: true });
await writeFile(new URL("flow-layout.svg", assets), layout);
await writeFile(new URL("badge-version.svg", assets), badge);
console.log("Built README flow diagram and version badge from public project files.");
