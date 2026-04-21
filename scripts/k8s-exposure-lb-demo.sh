#!/bin/sh

set -eu

K8S_NAMESPACE="${K8S_NAMESPACE:-crypto-simulator}"

service_name="$(kubectl -n "${K8S_NAMESPACE}" get service -l app.kubernetes.io/component=simulator-ui -o jsonpath='{.items[0].metadata.name}')"
attempt=0
external_ip=""

while [ "${attempt}" -lt 60 ]; do
  external_ip="$(kubectl -n "${K8S_NAMESPACE}" get service "${service_name}" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')"
  if [ -n "${external_ip}" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ -z "${external_ip}" ]; then
  echo "Timed out waiting for LoadBalancer IP on ${service_name}" >&2
  exit 1
fi

curl -fsS "http://${external_ip}/health" >/dev/null
curl -fsS "http://${external_ip}/core/health" >/dev/null
curl -fsS "http://${external_ip}/data/health" >/dev/null

ui_page="$(curl -fsS "http://${external_ip}/")"
printf '%s' "${ui_page}" | grep -q "Simulator Operator Platform"
