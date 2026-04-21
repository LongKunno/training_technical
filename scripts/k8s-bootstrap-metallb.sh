#!/bin/sh

set -eu

KIND_NETWORK_NAME="${KIND_NETWORK_NAME:-kind}"
METALLB_NAMESPACE="${METALLB_NAMESPACE:-metallb-system}"
METALLB_POOL_NAME="${K8S_METALLB_POOL_NAME:-kind-pool}"
METALLB_L2_ADVERTISEMENT_MANIFEST="${K8S_METALLB_L2_ADVERTISEMENT_MANIFEST:-./k8s/infrastructure/metallb/l2advertisement.yaml}"

subnet="$(
  docker network inspect "${KIND_NETWORK_NAME}" -f '{{range .IPAM.Config}}{{println .Subnet}}{{end}}' \
    | grep -E '^[0-9]+\.' \
    | head -n 1
)"
if [ -z "${subnet}" ]; then
  echo "No IPv4 subnet found for kind network: ${KIND_NETWORK_NAME}" >&2
  exit 1
fi

prefix="${subnet#*/}"
network_ip="${subnet%/*}"

old_ifs="${IFS}"
IFS=.
set -- ${network_ip}
IFS="${old_ifs}"

octet_1="${1:-}"
octet_2="${2:-}"
octet_3="${3:-}"

case "${prefix}" in
  16)
    range_start="${octet_1}.${octet_2}.255.200"
    range_end="${octet_1}.${octet_2}.255.250"
    ;;
  20)
    range_octet_3=$((octet_3 + 15))
    range_start="${octet_1}.${octet_2}.${range_octet_3}.200"
    range_end="${octet_1}.${octet_2}.${range_octet_3}.250"
    ;;
  24)
    range_start="${octet_1}.${octet_2}.${octet_3}.200"
    range_end="${octet_1}.${octet_2}.${octet_3}.250"
    ;;
  *)
    echo "Unsupported kind network subnet: ${subnet}" >&2
    exit 1
    ;;
esac

cat <<EOF | kubectl apply -f -
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: ${METALLB_POOL_NAME}
  namespace: ${METALLB_NAMESPACE}
spec:
  addresses:
    - ${range_start}-${range_end}
EOF

kubectl apply -f "${METALLB_L2_ADVERTISEMENT_MANIFEST}"
