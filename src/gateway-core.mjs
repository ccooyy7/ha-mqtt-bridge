export const DEFAULT_CONFIG = {
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
  retain: {
    meta: true,
    state: true,
    availability: true,
    ack: false,
    result: false
  }
};

export function normalizeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    coreDomains: config.coreDomains || DEFAULT_CONFIG.coreDomains,
    writableDomains: config.writableDomains || DEFAULT_CONFIG.writableDomains,
    entities: config.entities || DEFAULT_CONFIG.entities,
    entityAllowlist: config.entityAllowlist || DEFAULT_CONFIG.entityAllowlist,
    entityBlocklist: config.entityBlocklist || DEFAULT_CONFIG.entityBlocklist,
    aliases: config.aliases || DEFAULT_CONFIG.aliases,
    units: config.units || DEFAULT_CONFIG.units,
    stateFields: {
      ...DEFAULT_CONFIG.stateFields,
      ...(config.stateFields || {})
    },
    retain: {
      ...DEFAULT_CONFIG.retain,
      ...(config.retain || {})
    }
  };
}

export function splitEntityId(entityId) {
  if (!entityId || typeof entityId !== "string" || !entityId.includes(".")) {
    throw new Error(`Invalid entity_id: ${entityId}`);
  }
  const [domain, ...rest] = entityId.split(".");
  const objectId = rest.join(".");
  if (!domain || !objectId) {
    throw new Error(`Invalid entity_id: ${entityId}`);
  }
  return { domain, objectId };
}

export function isEntityExposed(entityId, config = DEFAULT_CONFIG) {
  const normalized = normalizeConfig(config);
  if (normalized.entityBlocklist.includes(entityId)) return false;
  if (normalized.exposureMode === "manual") {
    return normalized.entities.some((entity) => entity.entity_id === entityId && entity.enabled !== false);
  }
  if (normalized.exposureMode !== "domains") return false;
  const { domain } = splitEntityId(entityId);
  if (!normalized.coreDomains.includes(domain)) return false;
  if (normalized.entityBlocklist.includes(entityId)) return false;
  if (normalized.entityAllowlist.length > 0) {
    return normalized.entityAllowlist.includes(entityId);
  }
  return true;
}

export function entitySlug(entityId, config = DEFAULT_CONFIG) {
  const normalized = normalizeConfig(config);
  if (normalized.topicMode === "entity_id") return entityId;
  const entityConfig = getEntityConfig(entityId, normalized);
  if (entityConfig && entityConfig.topic) return entityConfig.topic;
  return normalized.aliases[entityId] || splitEntityId(entityId).objectId;
}

export function baseTopic(entityId, config = DEFAULT_CONFIG) {
  const normalized = normalizeConfig(config);
  if (normalized.topicMode === "entity_id") {
    return `${normalized.topicPrefix}/${normalized.site}/entity/${entityId}`;
  }
  const { domain } = splitEntityId(entityId);
  return `${normalized.topicPrefix}/${normalized.site}/${domain}/${entitySlug(entityId, normalized)}`;
}

export function metaPayload(state, config = DEFAULT_CONFIG) {
  const normalized = normalizeConfig(config);
  const entityId = state.entity_id;
  const { domain } = splitEntityId(entityId);
  const attributes = state.attributes || {};
  const entityConfig = getEntityConfig(entityId, normalized);
  const writable = entityConfig && entityConfig.writable !== undefined
    ? entityConfig.writable
    : normalized.writableDomains.includes(domain);
  const supportedFeatures = attributes.supported_features || 0;

  return {
    entity_id: entityId,
    domain,
    object_id: splitEntityId(entityId).objectId,
    topic_base: baseTopic(entityId, normalized),
    name: entityConfig?.name || attributes.friendly_name || entityId,
    writable,
    unit_of_measurement: normalized.units[entityId] || attributes.unit_of_measurement || null,
    device_class: attributes.device_class || null,
    state_class: attributes.state_class || null,
    supported_features: supportedFeatures,
    commands: writable ? (entityConfig?.commands || commandsForDomain(domain)).filter(command => commandsForDomain(domain).includes(command)) : []
  };
}

export function statePayload(state, config = DEFAULT_CONFIG) {
  const normalized = normalizeConfig(config);
  const entityId = state.entity_id;
  const { domain } = splitEntityId(entityId);
  const attributes = state.attributes || {};
  const entityConfig = getEntityConfig(entityId, normalized);
  const selectedFields = entityConfig?.state_fields || normalized.stateFields[domain];
  const selectedAttributes = selectedFields
    ? Object.fromEntries(selectedFields.map((field) => [field, stateFieldValue(field, state, attributes)]))
    : attributes;
  return {
    entity_id: entityId,
    state: state.state,
    ...selectedAttributes,
    unit_of_measurement: normalized.units[entityId] || attributes.unit_of_measurement || null,
    last_changed: state.last_changed || null,
    last_updated: state.last_updated || null,
    updated_at: new Date().toISOString()
  };
}

function stateFieldValue(field, state, attributes) {
  if (field === "brightness_pct") {
    if (attributes.brightness === undefined || attributes.brightness === null) return null;
    return Math.round((Number(attributes.brightness) / 255) * 100);
  }
  if (field === "target_temperature") return attributes.temperature ?? null;
  if (field === "hvac_mode") return state.state ?? null;
  return attributes[field] ?? null;
}

export function availabilityPayload(state) {
  return state && state.state !== "unavailable" ? "online" : "offline";
}

export function parseCommandTopic(topic, config = DEFAULT_CONFIG) {
  const normalized = normalizeConfig(config);
  const parts = String(topic || "").split("/");
  if (parts.length !== 5) {
    throw new Error("Topic must match gw/{site}/{domain}/{object_id}/set");
  }
  const [prefix, site, domain, objectId, suffix] = parts;
  if (prefix !== normalized.topicPrefix || site !== normalized.site || suffix !== "set") {
    throw new Error("Topic is outside this gateway namespace");
  }
  return { domain, objectId };
}

export function parseCommandPayload(payload) {
  const body = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Payload must be a JSON object");
  }
  if (!body.request_id || typeof body.request_id !== "string") {
    throw new Error("request_id is required and must be a string");
  }
  if (!body.command || typeof body.command !== "string") {
    throw new Error("command is required and must be a string");
  }
  if (body.params !== undefined && (!body.params || typeof body.params !== "object" || Array.isArray(body.params))) {
    throw new Error("params must be an object");
  }
  return {
    request_id: body.request_id,
    command: body.command,
    params: body.params && typeof body.params === "object" ? body.params : {}
  };
}

export function assertCommandAllowed(entityId, command, config = DEFAULT_CONFIG) {
  const normalized = normalizeConfig(config);
  if (!isEntityExposed(entityId, normalized)) throw new Error("Entity is not exposed: " + entityId);
  const { domain } = splitEntityId(entityId);
  const entity = getEntityConfig(entityId, normalized);
  const writable = entity?.writable ?? normalized.writableDomains.includes(domain);
  if (!writable) throw new Error("Entity is read-only: " + entityId);
  const allowed = entity?.commands || commandsForDomain(domain);
  if (!allowed.includes(command) || !commandsForDomain(domain).includes(command)) {
    throw new Error("Command is not allowed: " + command);
  }
}

export function entityIdFromTopic(topic, config = DEFAULT_CONFIG) {
  const normalized = normalizeConfig(config);
  const parts = String(topic || "").split("/");
  if (normalized.topicMode === "entity_id") {
    if (parts.length !== 5) {
      throw new Error("Topic must match {prefix}/{site}/entity/{entity_id}/set");
    }
    const [prefix, site, entityMarker, entityId, suffix] = parts;
    if (prefix !== normalized.topicPrefix || site !== normalized.site || entityMarker !== "entity" || suffix !== "set") {
      throw new Error("Topic is outside this gateway namespace");
    }
    return entityId;
  }
  if (parts.length !== 5) {
    throw new Error("Topic must match {prefix}/{site}/{domain}/{object_id}/set");
  }
  const [prefix, site, domain, objectId, suffix] = parts;
  if (prefix !== normalized.topicPrefix || site !== normalized.site || suffix !== "set") {
    throw new Error("Topic is outside this gateway namespace");
  }
  const configured = normalized.entities.find((entity) => {
    if (entity.enabled === false) return false;
    const parsed = splitEntityId(entity.entity_id);
    return parsed.domain === domain && (entity.topic || parsed.objectId) === objectId;
  });
  if (configured) return configured.entity_id;
  const aliasMatch = Object.keys(normalized.aliases).find((entityId) => {
    return normalized.aliases[entityId] === objectId && entityId.startsWith(`${domain}.`);
  });
  return aliasMatch || `${domain}.${objectId}`;
}

export function buildServiceCall(entityId, command, params = {}) {
  const { domain } = splitEntityId(entityId);

  if (domain === "light") {
    if (!["turn_on", "turn_off", "toggle"].includes(command)) {
      throw new Error(`Unsupported light command: ${command}`);
    }
    const data = filterDefined({
      entity_id: entityId,
      brightness: params.brightness,
      brightness_pct: params.brightness_pct,
      color_temp_kelvin: params.color_temp_kelvin,
      rgb_color: params.rgb_color,
      transition: params.transition
    });
    validateRange(data.brightness, "brightness", 0, 255);
    validateRange(data.brightness_pct, "brightness_pct", 0, 100);
    return { domain, service: command, data };
  }

  if (domain === "switch") {
    if (!["turn_on", "turn_off", "toggle"].includes(command)) {
      throw new Error(`Unsupported switch command: ${command}`);
    }
    return { domain, service: command, data: { entity_id: entityId } };
  }

  if (domain === "input_boolean") {
    if (!["turn_on", "turn_off", "toggle"].includes(command)) {
      throw new Error(`Unsupported input_boolean command: ${command}`);
    }
    return { domain, service: command, data: { entity_id: entityId } };
  }

  if (domain === "cover") {
    const allowed = ["open_cover", "close_cover", "stop_cover", "set_cover_position"];
    if (!allowed.includes(command)) {
      throw new Error(`Unsupported cover command: ${command}`);
    }
    const data = filterDefined({
      entity_id: entityId,
      position: params.position
    });
    validateRange(data.position, "position", 0, 100);
    return { domain, service: command, data };
  }

  if (domain === "fan") {
    const allowed = ["turn_on", "turn_off", "toggle", "set_percentage", "set_preset_mode"];
    if (!allowed.includes(command)) {
      throw new Error(`Unsupported fan command: ${command}`);
    }
    const data = filterDefined({
      entity_id: entityId,
      percentage: params.percentage,
      preset_mode: params.preset_mode
    });
    validateRange(data.percentage, "percentage", 0, 100);
    return { domain, service: command, data };
  }

  if (domain === "input_button") {
    if (command !== "press") {
      throw new Error(`Unsupported input_button command: ${command}`);
    }
    return { domain, service: command, data: { entity_id: entityId } };
  }

  if (domain === "scene") {
    if (command !== "turn_on") {
      throw new Error(`Unsupported scene command: ${command}`);
    }
    return { domain, service: command, data: { entity_id: entityId } };
  }

  if (domain === "climate") {
    const allowed = ["set_temperature", "set_hvac_mode", "set_preset_mode", "set_fan_mode", "turn_on", "turn_off"];
    if (!allowed.includes(command)) {
      throw new Error(`Unsupported climate command: ${command}`);
    }
    const data = filterDefined({
      entity_id: entityId,
      temperature: params.temperature,
      target_temp_high: params.target_temp_high,
      target_temp_low: params.target_temp_low,
      hvac_mode: params.hvac_mode,
      preset_mode: params.preset_mode,
      fan_mode: params.fan_mode
    });
    return { domain, service: command, data };
  }

  throw new Error(`${domain} is read-only or unsupported for commands`);
}

export function resultPayload(requestId, entityId, status, extra = {}) {
  return {
    request_id: requestId,
    entity_id: entityId,
    status,
    ts: new Date().toISOString(),
    ...extra
  };
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

function getEntityConfig(entityId, config) {
  return (config.entities || []).find((entity) => entity.entity_id === entityId && entity.enabled !== false) || null;
}

function validateRange(value, name, min, max) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
}

function filterDefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
