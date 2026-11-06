import { readFile } from "node:fs/promises";

const flowUrl = new URL("../flows/ha-mqtt-bridge.json", import.meta.url);
const flow = JSON.parse(await readFile(flowUrl, "utf8"));

const requiredTypes = [
  "tab",
  "mqtt-broker",
  "server",
  "server-events",
  "mqtt in",
  "mqtt out",
  "api-call-service",
  "function"
];

const types = new Set(flow.map((node) => node.type));
const missing = requiredTypes.filter((type) => !types.has(type));
if (missing.length) {
  throw new Error(`Missing required Node-RED node types: ${missing.join(", ")}`);
}

const commandInput = flow.find((node) => node.type === "mqtt in" && node.topic === "+/+/+/+/set");
if (!commandInput) {
  throw new Error("Missing command MQTT input for +/+/+/+/set");
}
if (commandInput.datatype !== "utf8") {
  throw new Error("Command MQTT input must use utf8 so invalid JSON can produce result errors");
}

const stateEvents = flow.find((node) => node.type === "server-events" && node.eventType === "state_changed");
if (!stateEvents) {
  throw new Error("Missing HA state_changed server-events listener");
}

const mqttOutCount = flow.filter((node) => node.type === "mqtt out").length;
if (mqttOutCount < 5) {
  throw new Error(`Expected at least 5 MQTT output nodes, found ${mqttOutCount}`);
}

for (const node of flow.filter((item) => item.type === "function")) {
  try {
    new Function("msg", "node", "flow", "global", node.func);
  } catch (error) {
    throw new Error(`Function node "${node.name}" has invalid JavaScript: ${error.message}`);
  }
}

console.log(`Validated ${flow.length} Node-RED nodes in ${flowUrl.pathname}`);
