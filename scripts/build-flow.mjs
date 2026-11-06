import { mkdir, readFile, writeFile } from "node:fs/promises";

const output = new URL("../flows/ha-mqtt-bridge.json", import.meta.url);
const gatewayConfigSource = await readFile(new URL("../config/gateway.config.js", import.meta.url), "utf8");

const ids = {
  tab: "ha_mqtt_gateway_tab",
  mqttBroker: "mqtt_broker_local",
  haServer: "ha_server_local",
  injectDiscovery: "inject_discovery",
  prepareDiscovery: "fn_prepare_discovery",
  publishMeta: "mqtt_meta",
  publishStateFromDiscovery: "mqtt_state_discovery",
  publishAvailabilityDiscovery: "mqtt_availability_discovery",
  normalizeDiscovery: "fn_normalize_discovery_mqtt",
  haEvents: "ha_events_state_changed",
  prepareState: "fn_prepare_state",
  publishState: "mqtt_state",
  publishAvailability: "mqtt_availability",
  mqttInCommand: "mqtt_command_in",
  prepareCommand: "fn_prepare_command",
  publishAck: "mqtt_ack",
  callService: "ha_call_service",
  serviceSuccess: "fn_service_success",
  serviceError: "catch_service_error",
  prepareServiceError: "fn_service_error",
  publishResultSuccess: "mqtt_result_success",
  publishResultError: "mqtt_result_error",
  statusNode: "status_gateway",
  statusFn: "fn_status_availability",
  statusMqtt: "mqtt_gateway_availability",
  commentSetup: "comment_setup",
  commentDiscovery: "comment_discovery",
  commentState: "comment_state",
  commentCommand: "comment_command"
};

const commonConfigSource = `
const DEFAULT_CONFIG = {
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
const config = { ...DEFAULT_CONFIG, ...(flow.get("gatewayConfig") || {}) };
config.retain = { ...DEFAULT_CONFIG.retain, ...(config.retain || {}) };
config.stateFields = { ...DEFAULT_CONFIG.stateFields, ...(config.stateFields || {}) };
function splitEntityId(entityId) {
    const parts = String(entityId || "").split(".");
    if (parts.length < 2 || !parts[0] || !parts.slice(1).join(".")) throw new Error("Invalid entity_id: " + entityId);
    return { domain: parts[0], objectId: parts.slice(1).join(".") };
}
function exposed(entityId) {
    if (config.entityBlocklist.includes(entityId)) return false;
    if (config.exposureMode === "manual") {
        return config.entities.some((entity) => entity.entity_id === entityId && entity.enabled !== false);
    }
    if (config.exposureMode !== "domains") return false;
    const { domain } = splitEntityId(entityId);
    if (!config.coreDomains.includes(domain)) return false;
    if (config.entityBlocklist.includes(entityId)) return false;
    if (config.entityAllowlist.length > 0) return config.entityAllowlist.includes(entityId);
    return true;
}
function baseTopic(entityId) {
    if (config.topicMode === "entity_id") {
        return config.topicPrefix + "/" + config.site + "/entity/" + entityId;
    }
    const { domain, objectId } = splitEntityId(entityId);
    const entityConfig = getEntityConfig(entityId);
    const slug = entityConfig && entityConfig.topic ? entityConfig.topic : (config.aliases[entityId] || objectId);
    return config.topicPrefix + "/" + config.site + "/" + domain + "/" + slug;
}
function getEntityConfig(entityId) {
    return (config.entities || []).find((entity) => entity.entity_id === entityId && entity.enabled !== false) || null;
}
function commandsForDomain(domain) {
    if (domain === "light") return ["turn_on", "turn_off", "toggle"];
    if (domain === "switch") return ["turn_on", "turn_off", "toggle"];
    if (domain === "input_boolean") return ["turn_on", "turn_off", "toggle"];
    if (domain === "cover") return ["open_cover", "close_cover", "stop_cover", "set_cover_position"];
    if (domain === "fan") return ["turn_on", "turn_off", "toggle", "set_percentage", "set_preset_mode"];
    if (domain === "input_button") return ["press"];
    if (domain === "scene") return ["turn_on"];
    if (domain === "climate") return ["set_temperature", "set_hvac_mode", "set_preset_mode", "set_fan_mode", "turn_on", "turn_off"];
    return [];
}
function assertCommandAllowed(entityId, command) {
    if (!exposed(entityId)) throw new Error("Entity is not exposed: " + entityId);
    const { domain } = splitEntityId(entityId);
    const entity = getEntityConfig(entityId);
    const writable = entity && entity.writable !== undefined ? entity.writable : config.writableDomains.includes(domain);
    if (!writable) throw new Error("Entity is read-only: " + entityId);
    const allowed = (entity && entity.commands) || commandsForDomain(domain);
    if (!allowed.includes(command) || !commandsForDomain(domain).includes(command)) throw new Error("Command is not allowed: " + command);
}
function metaPayload(state) {
    const entityId = state.entity_id;
    const { domain, objectId } = splitEntityId(entityId);
    const attributes = state.attributes || {};
    const entityConfig = getEntityConfig(entityId);
    const writable = entityConfig && entityConfig.writable !== undefined ? entityConfig.writable : config.writableDomains.includes(domain);
    return {
        entity_id: entityId,
        domain,
        object_id: objectId,
        topic_base: baseTopic(entityId),
        name: (entityConfig && entityConfig.name) || attributes.friendly_name || entityId,
        writable,
        unit_of_measurement: config.units[entityId] || attributes.unit_of_measurement || null,
        device_class: attributes.device_class || null,
        state_class: attributes.state_class || null,
        supported_features: attributes.supported_features || 0,
        commands: writable ? ((entityConfig && entityConfig.commands) || commandsForDomain(domain)).filter(command => commandsForDomain(domain).includes(command)) : []
    };
}
function statePayload(state) {
    const { domain } = splitEntityId(state.entity_id);
    const attributes = state.attributes || {};
    const entityConfig = getEntityConfig(state.entity_id);
    const fields = (entityConfig && entityConfig.state_fields) || config.stateFields[domain];
    const selected = {};
    if (fields) {
        fields.forEach((field) => {
            if (field === "brightness_pct") {
                selected[field] = attributes.brightness === undefined || attributes.brightness === null
                    ? null
                    : Math.round((Number(attributes.brightness) / 255) * 100);
            } else if (field === "target_temperature") {
                selected[field] = attributes.temperature === undefined ? null : attributes.temperature;
            } else if (field === "hvac_mode") {
                selected[field] = state.state === undefined ? null : state.state;
            } else {
                selected[field] = attributes[field] === undefined ? null : attributes[field];
            }
        });
    } else {
        Object.assign(selected, attributes);
    }
    return {
        entity_id: state.entity_id,
        state: state.state,
        ...selected,
        unit_of_measurement: config.units[state.entity_id] || attributes.unit_of_measurement || null,
        last_changed: state.last_changed || null,
        last_updated: state.last_updated || null,
        updated_at: new Date().toISOString()
    };
}
function availabilityPayload(state) {
    return state && state.state !== "unavailable" ? "online" : "offline";
}
function resultPayload(requestId, entityId, status, extra) {
    return { request_id: requestId, entity_id: entityId, status, ts: new Date().toISOString(), ...(extra || {}) };
}
function filterDefined(value) {
    const out = {};
    Object.keys(value).forEach((key) => {
        if (value[key] !== undefined) out[key] = value[key];
    });
    return out;
}
function validateRange(value, name, min, max) {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(name + " must be a number between " + min + " and " + max);
}
function buildServiceCall(entityId, command, params) {
    const { domain } = splitEntityId(entityId);
    params = params || {};
    if (domain === "light") {
        if (!["turn_on", "turn_off", "toggle"].includes(command)) throw new Error("Unsupported light command: " + command);
        const data = filterDefined({ entity_id: entityId, brightness: params.brightness, brightness_pct: params.brightness_pct, color_temp_kelvin: params.color_temp_kelvin, rgb_color: params.rgb_color, transition: params.transition });
        validateRange(data.brightness, "brightness", 0, 255);
        validateRange(data.brightness_pct, "brightness_pct", 0, 100);
        return { domain, service: command, data };
    }
    if (domain === "switch") {
        if (!["turn_on", "turn_off", "toggle"].includes(command)) throw new Error("Unsupported switch command: " + command);
        return { domain, service: command, data: { entity_id: entityId } };
    }
    if (domain === "input_boolean") {
        if (!["turn_on", "turn_off", "toggle"].includes(command)) throw new Error("Unsupported input_boolean command: " + command);
        return { domain, service: command, data: { entity_id: entityId } };
    }
    if (domain === "cover") {
        if (!["open_cover", "close_cover", "stop_cover", "set_cover_position"].includes(command)) throw new Error("Unsupported cover command: " + command);
        const data = filterDefined({ entity_id: entityId, position: params.position });
        validateRange(data.position, "position", 0, 100);
        return { domain, service: command, data };
    }
    if (domain === "fan") {
        if (!["turn_on", "turn_off", "toggle", "set_percentage", "set_preset_mode"].includes(command)) throw new Error("Unsupported fan command: " + command);
        const data = filterDefined({ entity_id: entityId, percentage: params.percentage, preset_mode: params.preset_mode });
        validateRange(data.percentage, "percentage", 0, 100);
        return { domain, service: command, data };
    }
    if (domain === "input_button") {
        if (command !== "press") throw new Error("Unsupported input_button command: " + command);
        return { domain, service: command, data: { entity_id: entityId } };
    }
    if (domain === "scene") {
        if (command !== "turn_on") throw new Error("Unsupported scene command: " + command);
        return { domain, service: command, data: { entity_id: entityId } };
    }
    if (domain === "climate") {
        if (!["set_temperature", "set_hvac_mode", "set_preset_mode", "set_fan_mode", "turn_on", "turn_off"].includes(command)) throw new Error("Unsupported climate command: " + command);
        return { domain, service: command, data: filterDefined({ entity_id: entityId, temperature: params.temperature, target_temp_high: params.target_temp_high, target_temp_low: params.target_temp_low, hvac_mode: params.hvac_mode, preset_mode: params.preset_mode, fan_mode: params.fan_mode }) };
    }
    throw new Error(domain + " is read-only or unsupported for commands");
}
`;

const flow = [
  { id: ids.tab, type: "tab", label: "HA MQTT Bridge", disabled: false, info: "" },
  {
    id: ids.mqttBroker,
    type: "mqtt-broker",
    name: "Local Mosquitto",
    broker: "core-mosquitto",
    port: "1883",
    clientid: "",
    autoConnect: true,
    usetls: false,
    protocolVersion: "4",
    keepalive: "60",
    cleansession: true,
    birthTopic: "gw/home/gateway/availability",
    birthQos: "1",
    birthPayload: "online",
    birthMsg: {},
    closeTopic: "gw/home/gateway/availability",
    closeQos: "1",
    closePayload: "offline",
    closeMsg: {},
    willTopic: "gw/home/gateway/availability",
    willQos: "1",
    willPayload: "offline",
    willMsg: {},
    sessionExpiry: ""
  },
  {
    id: ids.haServer,
    type: "server",
    name: "Home Assistant",
    version: 5,
    addon: true,
    rejectUnauthorizedCerts: true,
    ha_boolean: "y|yes|true|on|home|open",
    connectionDelay: true,
    cacheJson: true,
    heartbeat: false,
    heartbeatInterval: "30",
    areaSelector: "friendlyName",
    deviceSelector: "friendlyName",
    entitySelector: "friendlyName",
    statusSeparator: ": ",
    statusYear: "numeric",
    statusMonth: "short",
    statusDay: "numeric",
    statusHourCycle: "h23",
    statusTimeFormat: "h:m"
  },
  {
    id: ids.commentSetup,
    type: "comment",
    z: ids.tab,
    name: "Setup: select entities in Gateway config; configure HA and MQTT, deploy, initialize and discover.",
    info: "",
    x: 470,
    y: 40,
    wires: []
  },
  {
    id: "inject_gateway_config",
    type: "inject",
    z: ids.tab,
    name: "Init gateway config",
    props: [{ p: "payload" }],
    repeat: "",
    crontab: "",
    once: true,
    onceDelay: "0.5",
    topic: "",
    payload: "",
    payloadType: "date",
    x: 150,
    y: 100,
    wires: [["fn_gateway_config"]]
  },
  {
    id: "fn_gateway_config",
    type: "function",
    z: ids.tab,
    name: "Gateway config",
    func: gatewayConfigSource,
    outputs: 0,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 370,
    y: 100,
    wires: []
  },
  {
    id: ids.commentDiscovery,
    type: "comment",
    z: ids.tab,
    name: "Discovery: read HA cache and publish retained meta/state/availability for exposed entities.",
    info: "",
    x: 330,
    y: 160,
    wires: []
  },
  {
    id: ids.injectDiscovery,
    type: "inject",
    z: ids.tab,
    name: "Discover entities on deploy and every 10 min",
    props: [{ p: "payload" }],
    repeat: "600",
    crontab: "",
    once: true,
    onceDelay: "2",
    topic: "",
    payload: "",
    payloadType: "date",
    x: 190,
    y: 220,
    wires: [[ids.prepareDiscovery]]
  },
  {
    id: ids.prepareDiscovery,
    type: "function",
    z: ids.tab,
    name: "Build meta/state/availability messages",
    func: `${commonConfigSource}
const states = Array.isArray(msg.payload)
    ? msg.payload
    : Object.values(global.get("homeassistant.homeAssistant.states") || {});
let count = 0;
for (const state of states) {
    if (!state || !state.entity_id) continue;
    try {
        if (!exposed(state.entity_id)) continue;
        const topic = baseTopic(state.entity_id);
        node.send({ topic: topic + "/meta", payload: metaPayload(state), retain: config.retain.meta, qos: 1 });
        node.send({ topic: topic + "/state", payload: statePayload(state), retain: config.retain.state, qos: 1 });
        node.send({ topic: topic + "/availability", payload: availabilityPayload(state), retain: config.retain.availability, qos: 1 });
        count += 1;
    } catch (error) {
        node.warn(error.message);
    }
}
node.status({ fill: count > 0 ? "green" : "yellow", shape: "dot", text: "published " + count + " entities" });
return null;`,
    outputs: 1,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 500,
    y: 220,
    wires: [[ids.normalizeDiscovery]]
  },
  {
    id: ids.normalizeDiscovery,
    type: "function",
    z: ids.tab,
    name: "Normalize discovery MQTT message",
    func: `let outbound = msg;
if (!outbound.topic && outbound.payload && outbound.payload.topic) {
    outbound = {
        ...outbound.payload,
        _msgid: msg._msgid
    };
}
if (typeof outbound.topic !== "string" || outbound.topic.length === 0) {
    node.warn("Dropping discovery message without topic: " + JSON.stringify(outbound).slice(0, 500));
    return null;
}
if (outbound.topic.includes("+") || outbound.topic.includes("#")) {
    node.warn("Dropping discovery message with wildcard topic: " + outbound.topic);
    return null;
}
node.status({ fill: "green", shape: "dot", text: outbound.topic });
return outbound;`,
    outputs: 1,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 770,
    y: 220,
    wires: [[ids.publishMeta]]
  },
  {
    id: ids.publishMeta,
    type: "mqtt out",
    z: ids.tab,
    name: "Publish discovery messages",
    topic: "",
    qos: "",
    retain: "",
    respTopic: "",
    contentType: "",
    userProps: "",
    correl: "",
    expiry: "",
    broker: ids.mqttBroker,
    x: 1040,
    y: 220,
    wires: []
  },
  {
    id: ids.commentState,
    type: "comment",
    z: ids.tab,
    name: "State sync: every HA state_changed event becomes retained MQTT state + availability.",
    info: "",
    x: 350,
    y: 300,
    wires: []
  },
  {
    id: ids.haEvents,
    type: "server-events",
    z: ids.tab,
    name: "HA state_changed events",
    server: ids.haServer,
    version: 3,
    eventType: "state_changed",
    exposeAsEntityConfig: "",
    eventData: "",
    waitForRunning: true,
    outputProperties: [{ property: "payload", propertyType: "msg", value: "", valueType: "eventData" }],
    x: 160,
    y: 360,
    wires: [[ids.prepareState]]
  },
  {
    id: ids.prepareState,
    type: "function",
    z: ids.tab,
    name: "Build state MQTT messages",
    func: `${commonConfigSource}
const eventData = msg.payload && msg.payload.event ? msg.payload.event : msg.payload;
const state = eventData && eventData.new_state ? eventData.new_state : msg.payload;
if (!state || !state.entity_id || !exposed(state.entity_id)) return null;
const topic = baseTopic(state.entity_id);
node.send([
    { topic: topic + "/state", payload: statePayload(state), retain: config.retain.state, qos: 1 },
    { topic: topic + "/availability", payload: availabilityPayload(state), retain: config.retain.availability, qos: 1 }
]);
node.status({ fill: "green", shape: "dot", text: state.entity_id + " -> " + state.state });
return null;`,
    outputs: 2,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 430,
    y: 360,
    wires: [[ids.publishState], [ids.publishAvailability]]
  },
  {
    id: ids.publishState,
    type: "mqtt out",
    z: ids.tab,
    name: "Publish state",
    topic: "",
    qos: "",
    retain: "",
    broker: ids.mqttBroker,
    x: 700,
    y: 340,
    wires: []
  },
  {
    id: ids.publishAvailability,
    type: "mqtt out",
    z: ids.tab,
    name: "Publish availability",
    topic: "",
    qos: "",
    retain: "",
    broker: ids.mqttBroker,
    x: 720,
    y: 390,
    wires: []
  },
  {
    id: ids.commentCommand,
    type: "comment",
    z: ids.tab,
    name: "Commands: third party publishes .../set; gateway emits ack, calls HA service, then emits result.",
    info: "",
    x: 400,
    y: 460,
    wires: []
  },
  {
    id: ids.mqttInCommand,
    type: "mqtt in",
    z: ids.tab,
    name: "Command input {prefix}/{site}/+/+/set",
    topic: "+/+/+/+/set",
    qos: "1",
    datatype: "utf8",
    broker: ids.mqttBroker,
    nl: false,
    rap: true,
    rh: 0,
    inputs: 0,
    x: 190,
    y: 520,
    wires: [[ids.prepareCommand]]
  },
  {
    id: ids.prepareCommand,
    type: "function",
    z: ids.tab,
    name: "Validate command and build service call",
    func: `${commonConfigSource}
function entityFromTopic(topic) {
    const parts = String(topic || "").split("/");
    if (config.topicMode === "entity_id") {
        if (parts.length !== 5) throw new Error("Topic must match gw/{site}/entity/{entity_id}/set");
        const [prefix, site, marker, entityId, suffix] = parts;
        if (prefix !== config.topicPrefix || site !== config.site || marker !== "entity" || suffix !== "set") throw new Error("Topic is outside this gateway namespace");
        return entityId;
    }
    if (parts.length !== 5) throw new Error("Topic must match gw/{site}/{domain}/{object_id}/set");
    const [prefix, site, domain, objectId, suffix] = parts;
    if (prefix !== config.topicPrefix || site !== config.site || suffix !== "set") throw new Error("Topic is outside this gateway namespace");
    const configured = (config.entities || []).find((entity) => {
        if (entity.enabled === false) return false;
        const parsed = splitEntityId(entity.entity_id);
        return parsed.domain === domain && (entity.topic || parsed.objectId) === objectId;
    });
    if (configured) return configured.entity_id;
    const aliases = config.aliases || {};
    const aliasMatch = Object.keys(aliases).find((entityId) => aliases[entityId] === objectId && entityId.startsWith(domain + "."));
    return aliasMatch || domain + "." + objectId;
}
function parsePayload(payload) {
    const body = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Payload must be a JSON object");
    if (!body.request_id || typeof body.request_id !== "string") throw new Error("request_id is required and must be a string");
    if (!body.command || typeof body.command !== "string") throw new Error("command is required and must be a string");
    if (body.params !== undefined && (!body.params || typeof body.params !== "object" || Array.isArray(body.params))) throw new Error("params must be an object");
    return { request_id: body.request_id, command: body.command, params: body.params && typeof body.params === "object" ? body.params : {} };
}
const topicParts = String(msg.topic || "").split("/");
if (topicParts[0] !== config.topicPrefix || topicParts[1] !== config.site) return null;
let requestId = "unknown";
try {
    const body = typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload;
    if (body && typeof body.request_id === "string") requestId = body.request_id;
} catch (_) {}
try {
    const entityId = entityFromTopic(msg.topic);
    if (msg.retain === true) throw new Error("Retained commands are not accepted");
    if (!exposed(entityId)) throw new Error("Entity is not exposed: " + entityId);
    const command = parsePayload(msg.payload);
    assertCommandAllowed(entityId, command.command);
    const serviceCall = buildServiceCall(entityId, command.command, command.params);
    msg.gateway = { request_id: command.request_id, entity_id: entityId, received_topic: msg.topic };
    const ack = {
        topic: baseTopic(entityId) + "/ack",
        payload: resultPayload(command.request_id, entityId, "accepted", { command: command.command }),
        retain: config.retain.ack,
        qos: 1
    };
    const service = {
        payload: {
            action: serviceCall.domain + "." + serviceCall.service,
            target: { entity_id: [entityId] },
            data: { ...serviceCall.data }
        },
        domain: serviceCall.domain,
        service: serviceCall.service,
        data: serviceCall.data,
        gateway: msg.gateway
    };
    delete service.payload.data.entity_id;
    return [ack, service, null];
} catch (error) {
    const fallbackEntity = (() => {
        try { return entityFromTopic(msg.topic); } catch (_) { return "unknown.unknown"; }
    })();
    const topicBase = fallbackEntity === "unknown.unknown" ? config.topicPrefix + "/" + config.site + "/gateway/command" : baseTopic(fallbackEntity);
    return [null, null, {
        topic: topicBase + "/result",
        payload: resultPayload(requestId, fallbackEntity, "error", { error: error.message }),
        retain: config.retain.result,
        qos: 1
    }];
}`,
    outputs: 3,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 490,
    y: 520,
    wires: [[ids.publishAck], [ids.callService], [ids.publishResultError]]
  },
  {
    id: ids.publishAck,
    type: "mqtt out",
    z: ids.tab,
    name: "Publish ack",
    topic: "",
    qos: "",
    retain: "",
    broker: ids.mqttBroker,
    x: 790,
    y: 480,
    wires: []
  },
  {
    id: ids.callService,
    type: "api-call-service",
    z: ids.tab,
    name: "Call HA service",
    server: ids.haServer,
    version: 7,
    debugenabled: false,
    action: "",
    floorId: [],
    areaId: [],
    deviceId: [],
    entityId: [],
    labelId: [],
    data: "",
    dataType: "json",
    mergeContext: "",
    mustacheAltTags: false,
    outputProperties: [],
    queue: "none",
    blockInputOverrides: false,
    domain: "",
    service: "",
    x: 790,
    y: 540,
    wires: [[ids.serviceSuccess]]
  },
  {
    id: ids.serviceSuccess,
    type: "function",
    z: ids.tab,
    name: "Build success result",
    func: `${commonConfigSource}
if (!msg.gateway) return null;
return {
    topic: baseTopic(msg.gateway.entity_id) + "/result",
    payload: resultPayload(msg.gateway.request_id, msg.gateway.entity_id, "success"),
    retain: config.retain.result,
    qos: 1
};`,
    outputs: 1,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 1020,
    y: 540,
    wires: [[ids.publishResultSuccess]]
  },
  {
    id: ids.publishResultSuccess,
    type: "mqtt out",
    z: ids.tab,
    name: "Publish success result",
    topic: "",
    qos: "",
    retain: "",
    broker: ids.mqttBroker,
    x: 1260,
    y: 540,
    wires: []
  },
  {
    id: ids.serviceError,
    type: "catch",
    z: ids.tab,
    name: "Catch HA service errors",
    scope: [ids.callService],
    uncaught: false,
    x: 780,
    y: 620,
    wires: [[ids.prepareServiceError]]
  },
  {
    id: ids.prepareServiceError,
    type: "function",
    z: ids.tab,
    name: "Build service error result",
    func: `${commonConfigSource}
const source = msg.error && msg.error.source ? msg.error.source : {};
const original = msg.error && msg.error.message ? msg.error.message : "HA service call failed";
const gateway = msg.gateway || (msg._msg && msg._msg.gateway) || {};
if (!gateway.entity_id) return null;
return {
    topic: baseTopic(gateway.entity_id) + "/result",
    payload: resultPayload(gateway.request_id || "unknown", gateway.entity_id, "error", { error: original, source }),
    retain: config.retain.result,
    qos: 1
};`,
    outputs: 1,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 1030,
    y: 620,
    wires: [[ids.publishResultError]]
  },
  {
    id: ids.publishResultError,
    type: "mqtt out",
    z: ids.tab,
    name: "Publish error result",
    topic: "",
    qos: "",
    retain: "",
    broker: ids.mqttBroker,
    x: 1260,
    y: 620,
    wires: []
  }
];

await mkdir(new URL("../flows", import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(flow, null, 2)}\n`);
console.log(`Wrote ${output.pathname}`);
