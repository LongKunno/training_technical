#!/bin/sh

set -eu

K8S_NAMESPACE="${K8S_NAMESPACE:-crypto-simulator}"
SIMULATOR_INGRESS_HOST="${SIMULATOR_INGRESS_HOST:-simulator.localtest.me}"
SIMULATOR_INGRESS_PORT="${SIMULATOR_INGRESS_PORT:-18020}"
ROLLOUT_DEPLOYMENT_COMPONENT="${ROLLOUT_DEPLOYMENT_COMPONENT:-simulator-ui}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-2}"

curl_ingress() {
  curl --resolve "${SIMULATOR_INGRESS_HOST}:${SIMULATOR_INGRESS_PORT}:127.0.0.1" -fsS "$@"
}

deployment_name="$(kubectl -n "${K8S_NAMESPACE}" get deployment -l app.kubernetes.io/component="${ROLLOUT_DEPLOYMENT_COMPONENT}" -o jsonpath='{.items[0].metadata.name}')"
replicas="$(kubectl -n "${K8S_NAMESPACE}" get deployment "${deployment_name}" -o jsonpath='{.spec.replicas}')"

if [ "${replicas}" -lt 2 ]; then
  echo "Rollout demo expects at least 2 replicas for ${deployment_name}." >&2
  exit 1
fi

kubectl -n "${K8S_NAMESPACE}" rollout restart "deployment/${deployment_name}" >/dev/null
kubectl -n "${K8S_NAMESPACE}" rollout status "deployment/${deployment_name}" --timeout=300s &
rollout_pid=$!

health_failures=0
while kill -0 "${rollout_pid}" >/dev/null 2>&1; do
  if ! curl_ingress "http://${SIMULATOR_INGRESS_HOST}:${SIMULATOR_INGRESS_PORT}/health" >/dev/null 2>&1; then
    health_failures=$((health_failures + 1))
  fi
  sleep "${CHECK_INTERVAL_SECONDS}"
done

wait "${rollout_pid}"

if [ "${health_failures}" -gt 0 ]; then
  echo "Observed ${health_failures} failed health checks during rollout." >&2
  exit 1
fi
