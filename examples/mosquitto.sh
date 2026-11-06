#!/usr/bin/env bash
set -euo pipefail

: "${MQTT_HOST:?Set MQTT_HOST to your broker hostname}"
: "${MQTT_USER:?Set MQTT_USER}"
: "${MQTT_PASSWORD:?Set MQTT_PASSWORD}"
if [[ "$MQTT_HOST" == *.invalid ]]; then
  echo "Replace the example hostname with your own broker." >&2
  exit 2
fi
args=(-h "$MQTT_HOST" -p "${MQTT_PORT:-1883}" -u "$MQTT_USER" -P "$MQTT_PASSWORD" -q 1)
base="${MQTT_PREFIX:-gw}/${MQTT_SITE:-home}/entity"
mode="${1:-watch}"
if [[ "$mode" != "all" ]]; then
  : "${MQTT_ENTITY:?Set MQTT_ENTITY to your entity ID}"
  if [[ ! "$MQTT_ENTITY" =~ ^[a-z_]+\.[a-z0-9_]+$ ]]; then
    echo "MQTT_ENTITY must be an entity ID without topic wildcards." >&2
    exit 2
  fi
fi
case "$mode" in
  query) exec mosquitto_sub "${args[@]}" -t "$base/$MQTT_ENTITY/state" -C 1 -W 10 -v ;;
  watch) exec mosquitto_sub "${args[@]}" -t "$base/$MQTT_ENTITY/#" -v ;;
  all) exec mosquitto_sub "${args[@]}" -t "$base/+/state" -v ;;
  send)
    : "${MQTT_MESSAGE:?Set MQTT_MESSAGE to a JSON command}"
    exec mosquitto_pub "${args[@]}" -t "$base/$MQTT_ENTITY/set" -m "$MQTT_MESSAGE"
    ;;
  *) echo "Usage: bash examples/mosquitto.sh {query|watch|all|send}" >&2; exit 2 ;;
esac
