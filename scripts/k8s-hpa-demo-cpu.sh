#!/bin/sh

set -eu

K8S_NAMESPACE="${K8S_NAMESPACE:-crypto-simulator}"
K8S_OPS_BENCHMARK_TOKEN="${K8S_OPS_BENCHMARK_TOKEN:-k8s-demo-token}"
LOAD_POD_NAME="${LOAD_POD_NAME:-data-pipeline-cpu-load}"
WINDOW_SECONDS="${WINDOW_SECONDS:-90}"
PARALLEL_REQUESTS="${PARALLEL_REQUESTS:-6}"
REQUEST_DURATION_MS="${REQUEST_DURATION_MS:-15000}"
OUTER_LOOPS="${OUTER_LOOPS:-250000}"

deployment_name="$(kubectl -n "${K8S_NAMESPACE}" get deployment -l app.kubernetes.io/component=data-pipeline -o jsonpath='{.items[0].metadata.name}')"
service_name="$(kubectl -n "${K8S_NAMESPACE}" get service -l app.kubernetes.io/component=data-pipeline -o jsonpath='{.items[0].metadata.name}')"

kubectl -n "${K8S_NAMESPACE}" get hpa "${deployment_name}" >/dev/null
kubectl -n "${K8S_NAMESPACE}" delete pod "${LOAD_POD_NAME}" --ignore-not-found >/dev/null

kubectl -n "${K8S_NAMESPACE}" run "${LOAD_POD_NAME}" \
  --restart=Never \
  --image=curlimages/curl:8.11.1 \
  --env="TARGET_URL=http://${service_name}.${K8S_NAMESPACE}.svc.cluster.local:8000/internal/ops/benchmark/cpu" \
  --env="OPS_TOKEN=${K8S_OPS_BENCHMARK_TOKEN}" \
  --env="WINDOW_SECONDS=${WINDOW_SECONDS}" \
  --env="PARALLEL_REQUESTS=${PARALLEL_REQUESTS}" \
  --env="REQUEST_DURATION_MS=${REQUEST_DURATION_MS}" \
  --env="OUTER_LOOPS=${OUTER_LOOPS}" \
  --command -- sh -ec '
    end=$(( $(date +%s) + WINDOW_SECONDS ))
    worker=0
    while [ "$worker" -lt "$PARALLEL_REQUESTS" ]; do
      (
        while [ "$(date +%s)" -lt "$end" ]; do
          curl -fsS -X POST "$TARGET_URL" \
            -H "Content-Type: application/json" \
            -H "X-Ops-Token: $OPS_TOKEN" \
            -d "{\"duration_ms\":${REQUEST_DURATION_MS},\"outer_loops\":${OUTER_LOOPS}}" >/dev/null
        done
      ) &
      worker=$((worker + 1))
    done
    wait
  ' >/dev/null

attempt=0
while [ "${attempt}" -lt 18 ]; do
  kubectl -n "${K8S_NAMESPACE}" get hpa "${deployment_name}"
  kubectl -n "${K8S_NAMESPACE}" get deployment "${deployment_name}" -o wide
  sleep 10
  attempt=$((attempt + 1))
done

kubectl -n "${K8S_NAMESPACE}" delete pod "${LOAD_POD_NAME}" --ignore-not-found >/dev/null
