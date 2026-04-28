smoke_started_at() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

smoke_write_artifact() {
  smoke_name="$1"
  status="$2"
  jq_filter="$3"
  shift 3

  if [ -z "${SMOKE_ARTIFACT_DIR:-}" ]; then
    return 0
  fi

  mkdir -p "$SMOKE_ARTIFACT_DIR"
  artifact_path="${SMOKE_ARTIFACT_DIR%/}/${smoke_name}.json"
  finished_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  jq -n \
    --arg smoke "$smoke_name" \
    --arg status "$status" \
    --arg started_at "${SMOKE_STARTED_AT:-}" \
    --arg finished_at "$finished_at" \
    "$@" \
    "{smoke: \$smoke, status: \$status, started_at: \$started_at, finished_at: \$finished_at} + (${jq_filter})" \
    >"$artifact_path"
}
