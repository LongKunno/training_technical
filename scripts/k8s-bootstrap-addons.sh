#!/bin/sh

set -eu

KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-crypto-simulator}"
K8S_INGRESS_NGINX_MANIFEST="${K8S_INGRESS_NGINX_MANIFEST:-https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml}"
K8S_METRICS_SERVER_MANIFEST="${K8S_METRICS_SERVER_MANIFEST:-https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml}"
K8S_METALLB_MANIFEST="${K8S_METALLB_MANIFEST:-https://raw.githubusercontent.com/metallb/metallb/v0.14.9/config/manifests/metallb-native.yaml}"

kubectl label node "${KIND_CLUSTER_NAME}-control-plane" ingress-ready=true --overwrite

kubectl apply -f "${K8S_INGRESS_NGINX_MANIFEST}"
if kubectl -n ingress-nginx get job ingress-nginx-admission-create >/dev/null 2>&1; then
  kubectl -n ingress-nginx wait --for=condition=complete job/ingress-nginx-admission-create --timeout=180s
fi
if kubectl -n ingress-nginx get job ingress-nginx-admission-patch >/dev/null 2>&1; then
  kubectl -n ingress-nginx wait --for=condition=complete job/ingress-nginx-admission-patch --timeout=180s
fi
kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=180s

kubectl apply -f "${K8S_METRICS_SERVER_MANIFEST}"
if ! kubectl -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].args}' | grep -q -- '--kubelet-insecure-tls'; then
  kubectl -n kube-system patch deployment metrics-server --type=json \
    -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
fi
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s

kubectl apply -f "${K8S_METALLB_MANIFEST}"
kubectl -n metallb-system rollout status deployment/controller --timeout=180s
kubectl -n metallb-system rollout status daemonset/speaker --timeout=180s

sh ./scripts/k8s-bootstrap-metallb.sh
