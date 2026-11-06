import assert from "node:assert/strict";
import {
  baseTopic,
  buildServiceCall,
  entityIdFromTopic,
  isEntityExposed,
  metaPayload,
  parseCommandPayload,
  resultPayload,
  statePayload
} from "../src/gateway-core.mjs";

const config = {
  site: "home",
  topicPrefix: "gw",
  exposureMode: "domains",
  topicMode: "domain_object",
  aliases: { "light.living_room_main": "living_room_main" }
};

const portableConfig = {
  site: "home",
  topicPrefix: "gw",
  topicMode: "domain_object",
  entities: [
    {
      entity_id: "light.living_room_main",
      topic: "meeting_room_light",
      name: "Meeting Room Light",
      writable: true,
      state_fields: ["brightness_pct", "friendly_name"],
      commands: ["turn_on", "turn_off", "toggle"],
      enabled: true
    }
  ]
};

const entityIdTopicConfig = {
  site: "home",
  topicPrefix: "gw",
  exposureMode: "domains",
  topicMode: "entity_id",
  coreDomains: ["light", "climate"],
  writableDomains: ["light", "climate"]
};

const lightState = {
  entity_id: "light.living_room_main",
  state: "on",
  attributes: {
    friendly_name: "Living Room Main",
    brightness: 128,
    supported_features: 32
  },
  last_changed: "2026-05-14T01:00:00+00:00",
  last_updated: "2026-05-14T01:00:00+00:00"
};

const climateState = {
  entity_id: "climate.office",
  state: "cool",
  attributes: {
    friendly_name: "Office AC",
    current_temperature: 25,
    temperature: 23,
    preset_mode: "eco"
  }
};

assert.equal(baseTopic("light.living_room_main", config), "gw/home/light/living_room_main");
assert.equal(baseTopic("light.living_room_main", portableConfig), "gw/home/light/meeting_room_light");
assert.equal(baseTopic("climate.example", entityIdTopicConfig), "gw/home/entity/climate.example");
assert.equal(isEntityExposed("light.living_room_main", config), true);
assert.equal(isEntityExposed("light.living_room_main", portableConfig), true);
assert.equal(isEntityExposed("light.other", portableConfig), false);
assert.equal(isEntityExposed("automation.good_morning", config), false);
assert.equal(entityIdFromTopic("gw/home/light/meeting_room_light/set", portableConfig), "light.living_room_main");
assert.equal(entityIdFromTopic("gw/home/entity/climate.example/set", entityIdTopicConfig), "climate.example");

assert.deepEqual(metaPayload(lightState, config).commands, ["turn_on", "turn_off", "toggle"]);
assert.equal(metaPayload(lightState, config).writable, true);
const filteredLightState = statePayload(lightState, config);
assert.equal(filteredLightState.state, "on");
assert.equal(filteredLightState.brightness_pct, 50);
assert.equal(filteredLightState.color_temp_kelvin, null);
assert.equal(filteredLightState.friendly_name, "Living Room Main");
assert.equal(Object.hasOwn(filteredLightState, "attributes"), false);

assert.deepEqual(parseCommandPayload('{"request_id":"r1","command":"turn_on","params":{"brightness":200}}'), {
  request_id: "r1",
  command: "turn_on",
  params: { brightness: 200 }
});

assert.deepEqual(buildServiceCall("light.living_room_main", "turn_on", { brightness: 200 }), {
  domain: "light",
  service: "turn_on",
  data: {
    entity_id: "light.living_room_main",
    brightness: 200
  }
});

assert.deepEqual(buildServiceCall("cover.bedroom", "set_cover_position", { position: 60 }), {
  domain: "cover",
  service: "set_cover_position",
  data: {
    entity_id: "cover.bedroom",
    position: 60
  }
});

assert.deepEqual(buildServiceCall("input_boolean.virtual_lock_state", "toggle", {}), {
  domain: "input_boolean",
  service: "toggle",
  data: {
    entity_id: "input_boolean.virtual_lock_state"
  }
});

assert.deepEqual(
  {
    state: statePayload(climateState, config).state,
    current_temperature: statePayload(climateState, config).current_temperature,
    target_temperature: statePayload(climateState, config).target_temperature,
    hvac_mode: statePayload(climateState, config).hvac_mode,
    preset_mode: statePayload(climateState, config).preset_mode,
    friendly_name: statePayload(climateState, config).friendly_name
  },
  {
    state: "cool",
    current_temperature: 25,
    target_temperature: 23,
    hvac_mode: "cool",
    preset_mode: "eco",
    friendly_name: "Office AC"
  }
);

assert.throws(() => buildServiceCall("sensor.temperature", "turn_on", {}), /read-only/);
assert.throws(() => buildServiceCall("light.living_room_main", "turn_on", { brightness: 300 }), /brightness/);
assert.throws(() => parseCommandPayload('{"command":"turn_on"}'), /request_id/);

const result = resultPayload("r1", "light.living_room_main", "success");
assert.equal(result.request_id, "r1");
assert.equal(result.status, "success");

console.log("All protocol mapping tests passed");
