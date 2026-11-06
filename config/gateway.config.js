// Complete content of the Node-RED "Gateway config" Function.
// Manual mode with an empty list exposes no entities.
const gatewayConfig = {
    site: "home",
    topicPrefix: "gw",
    exposureMode: "manual",
    topicMode: "entity_id",
    coreDomains: ["climate", "cover", "fan", "input_button", "light", "scene", "sensor", "switch"],
    writableDomains: ["climate", "cover", "fan", "input_button", "light", "scene", "switch"],
    entities: [],
    entityAllowlist: [],
    entityBlocklist: [],
    aliases: {},
    units: {},
    stateFields: {
        light: ["brightness_pct", "color_temp_kelvin", "friendly_name"],
        switch: ["friendly_name"],
        input_boolean: ["friendly_name"],
        input_button: ["friendly_name"],
        scene: ["friendly_name"],
        sensor: ["friendly_name", "unit_of_measurement"],
        cover: ["current_position", "friendly_name"],
        fan: ["percentage", "preset_mode", "friendly_name"],
        climate: ["current_temperature", "target_temperature", "hvac_mode", "hvac_action", "fan_mode", "preset_mode", "friendly_name"]
    },
    retain: { meta: true, state: true, availability: true, ack: false, result: false }
};
flow.set("gatewayConfig", gatewayConfig);
node.status({ fill: "green", shape: "dot", text: "gateway config loaded" });
return null;
