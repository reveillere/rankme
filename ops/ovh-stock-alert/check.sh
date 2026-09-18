#!/bin/sh
set -eu

readonly endpoint="https://eu.api.ovh.com/v1/vps/order/rule/datacenter?ovhSubsidiary=FR&planCode=${OVH_PLAN_CODE}"
readonly state_file="/state/availability"

send_alert() {
  datacenters="$1"
  printf 'From: %s\nTo: %s\nSubject: [RankMe] VPS-3 OVH disponible en France (%s)\n\nLe VPS-3 2027 est disponible chez OVH en France : %s\n\nAPI surveillee : %s\n' \
    "$GMAIL_FROM" "$ALERT_TO" "$datacenters" "$datacenters" "$endpoint" \
    | msmtp --account=gmail "$ALERT_TO"
}

check_once() {
  response="$(curl --fail --silent --show-error --max-time 20 "$endpoint")" || {
    echo "$(date -Iseconds) OVH API request failed" >&2
    return 0
  }

  datacenters="$(printf '%s' "$response" | jq -er '[.datacenters[] | select((.datacenter == "RBX" or .datacenter == "GRA" or .datacenter == "SBG") and .linuxStatus == "available") | .datacenter] | join(",")')" || {
    echo "$(date -Iseconds) OVH API response was not understood" >&2
    return 0
  }

  if [ -n "$datacenters" ]; then
    current="available:$datacenters"
  else
    current="unavailable"
  fi
  previous="$(cat "$state_file" 2>/dev/null || true)"

  if [ "$current" != "$previous" ]; then
    echo "$(date -Iseconds) state changed: ${previous:-unknown} -> $current"
    if [ "$current" != "unavailable" ]; then
      if ! send_alert "$datacenters"; then
        echo "$(date -Iseconds) availability alert failed; will retry" >&2
        return 0
      fi
      echo "$(date -Iseconds) availability alert sent to $ALERT_TO"
    fi
    printf '%s\n' "$current" > "$state_file"
  fi
}

while :; do
  check_once
  sleep "$CHECK_INTERVAL_SECONDS"
done
