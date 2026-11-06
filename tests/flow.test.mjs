import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertCommandAllowed, isEntityExposed, metaPayload, normalizeConfig } from "../src/gateway-core.mjs";

const nodes = JSON.parse(readFileSync(new URL("../flows/ha-mqtt-bridge.json", import.meta.url)));
const manual = (entities = []) => normalizeConfig({ entities });
const editable = { entity_id: "light.example", writable: true, commands: ["turn_on", "turn_off"] };
const state = { entity_id: "light.example", state: "on", attributes: { brightness: 191.25, friendly_name: "Example Light" } };

function run(name, msg = {}, config, states = {}) {
  const sent = [];
  const writes = {};
  const node = { send: value => sent.push(value), status() {}, warn() {} };
  const flow = { get: () => config, set: (key, value) => { writes[key] = value; } };
  const global = { get: () => states };
  const source = nodes.find(n => n.name === name);
  assert(source, `Missing node ${name}`);
  const result = new Function("msg", "node", "flow", "global", source.func)(msg, node, flow, global);
  return { result, sent, writes };
}
function command(config, command = "turn_on", params = {}, extra = {}, entity = "light.example") {
  return run("Validate command and build service call", {
    topic: `gw/home/entity/${entity}/set`,
    payload: JSON.stringify({ request_id: "test-request", command, params }),
    ...extra
  }, config).result;
}
function assertRejected(result, pattern) {
  assert.equal(result[0], null);
  assert.equal(result[1], null);
  assert.equal(result[2].payload.status, "error");
  assert.match(result[2].payload.error, pattern);
}

test("imported config and uninitialized flow expose no entities", () => {
  const config = run("Gateway config").writes.gatewayConfig;
  assert.equal(isEntityExposed("light.example", config), false);
  assert.equal(run("Build meta/state/availability messages", { payload: [state] }, config).sent.length, 0);
  assert.equal(run("Build meta/state/availability messages", { payload: [state] }).sent.length, 0);
  assertRejected(command(config), /not exposed/);
  assertRejected(command(undefined), /not exposed/);
});

test("read-only, command lists, disabled entities and blocklists are enforced", () => {
  const cases = [
    [manual([{ ...editable, writable: false }]), /read-only/],
    [manual([{ ...editable, commands: [] }]), /not allowed/],
    [manual([{ ...editable, commands: ["turn_off"] }]), /not allowed/],
    [manual([{ ...editable, enabled: false }]), /not exposed/],
    [{ ...manual([editable]), entityBlocklist: ["light.example"] }, /not exposed/],
    [{ ...manual([editable]), exposureMode: "typo" }, /not exposed/],
    [normalizeConfig({ exposureMode: "domains", writableDomains: [] }), /read-only/]
  ];
  for (const [config, reason] of cases) {
    assert.throws(() => assertCommandAllowed("light.example", "turn_on", config), reason);
    const result = command(config);
    assertRejected(result, reason);
    assert.equal(result[2].payload.request_id, "test-request");
  }
});

test("domain exposure respects allowlist and blocklist", () => {
  const config = normalizeConfig({ exposureMode: "domains", entityAllowlist: ["light.example"] });
  assert.equal(isEntityExposed("light.other", config), false);
  assertRejected(command(config, "turn_on", {}, {}, "light.other"), /not exposed/);
  assert(command(config)[1]);
  config.entityBlocklist = ["light.example"];
  assertRejected(command(config), /not exposed/);
});

test("valid commands map to the intended service and target only", () => {
  const rows = [
    ["light.example", "turn_on", { brightness_pct: 75 }],
    ["switch.example", "turn_off", {}],
    ["cover.example", "set_cover_position", { position: 50 }],
    ["climate.example", "set_fan_mode", { fan_mode: "high" }],
    ["fan.example", "set_percentage", { percentage: 40 }],
    ["input_button.example", "press", {}],
    ["scene.example", "turn_on", {}],
    ["input_boolean.example", "turn_on", {}]
  ];
  for (const [entity, action, params] of rows) {
    const config = manual([{ entity_id: entity, writable: true }]);
    const [ack, service, error] = command(config, action, { ...params, entity_id: "light.other" }, {}, entity);
    assert.equal(error, null);
    assert.equal(ack.payload.status, "accepted");
    assert.equal(ack.retain, false);
    assert.equal(service.payload.action, `${entity.split(".")[0]}.${action}`);
    assert.deepEqual(service.payload.target.entity_id, [entity]);
    assert.deepEqual(service.payload.data, params);
  }
});

test("invalid requests never reach the service output", () => {
  const config = manual([editable]);
  assertRejected(command(config, "turn_on", { brightness_pct: 101 }), /brightness_pct/);
  assertRejected(command(config, "turn_on", {}, { payload: "{" }), /JSON|property/i);
  for (const params of [[], null, "invalid"]) assertRejected(command(config, "turn_on", params), /params/);
  assertRejected(command(config, "turn_on", {}, { retain: true }), /Retained/);
  assertRejected(command(manual([{ entity_id: "sensor.example" }]), "turn_on", {}, {}, "sensor.example"), /read-only/);
  assert.equal(command(config, "turn_on", {}, { topic: "gw/other/entity/light.example/set" }), null);
});

test("discovery publishes usable topics, filtered state and consistent read-only meta", () => {
  const config = manual([{ ...editable, writable: false }]);
  const { sent } = run("Build meta/state/availability messages", { payload: [state] }, config);
  assert.equal(sent.length, 3);
  for (const msg of sent) {
    assert.match(msg.topic, /^gw\/home\/entity\/light\.example\/(meta|state|availability)$/);
    assert.equal(msg.retain, true);
    assert.equal(run("Normalize discovery MQTT message", msg).result, msg);
  }
  assert.equal(sent[0].payload.writable, false);
  assert.deepEqual(sent[0].payload.commands, []);
  assert.deepEqual(metaPayload(state, config).commands, []);
  assert.equal(sent[1].payload.brightness_pct, 75);
  assert.equal(sent[1].payload.color_temp_kelvin, null);
  assert(!Object.hasOwn(sent[1].payload, "attributes"));
  assert.equal(run("Normalize discovery MQTT message", { payload: {} }).result, null);
  assert.equal(run("Normalize discovery MQTT message", { topic: "gw/#" }).result, null);
});

test("state events route state and availability to their respective outputs", () => {
  const config = manual([editable]);
  const { sent } = run("Build state MQTT messages", { payload: { event: { new_state: state } } }, config);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].topic, "gw/home/entity/light.example/state");
  assert.equal(sent[0][1].topic, "gw/home/entity/light.example/availability");
  assert.equal(sent[0][1].payload, "online");
  const offline = run("Build state MQTT messages", { payload: { new_state: { ...state, state: "unavailable" } } }, config);
  assert.equal(offline.sent[0][1].payload, "offline");
});

test("service success and error preserve command correlation", () => {
  const config = manual([editable]);
  const service = command(config)[1];
  const success = run("Build success result", service, config).result;
  assert.equal(success.payload.status, "success");
  assert.equal(success.payload.request_id, "test-request");
  assert.equal(success.retain, false);
  const failure = run("Build service error result", { ...service, error: { message: "service unavailable" } }, config).result;
  assert.equal(failure.payload.status, "error");
  assert.equal(failure.payload.request_id, "test-request");
  assert.equal(failure.payload.error, "service unavailable");
});
