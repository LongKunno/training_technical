.PHONY: up up-ui-dev down down-ui-dev test test-go test-py test-bot-runner lint-go lint-py lint-bot-runner typecheck-ui lint-ui test-ui build-ui test-e2e-ui test-e2e-ui-live test-e2e-ui-restore migrate-up migrate-down smoke-paper smoke-paper-kafka smoke-restore smoke-sim-run smoke-sim-experiment smoke-ui-runtime smoke-ui-dev clean-docker clean-docker-all k8s-kind-up k8s-kind-down k8s-build-images k8s-load-images k8s-lint k8s-template k8s-deploy k8s-redeploy-apps k8s-status k8s-smoke k8s-smoke-restore k8s-hpa-demo-cpu k8s-hpa-demo-memory k8s-rollout-demo k8s-exposure-nodeport-demo k8s-exposure-lb-demo k8s-static-pv-demo

KIND_CLUSTER_NAME ?= crypto-simulator
K8S_NAMESPACE ?= crypto-simulator
K8S_RELEASE ?= crypto-simulator
K8S_CHART_DIR ?= ./k8s/helm/crypto-simulator
K8S_VALUES ?= ./k8s/helm/crypto-simulator/values.yaml
K8S_PERSISTENT_VALUES ?= ./k8s/helm/crypto-simulator/values-persistent.yaml
K8S_DEV_EPHEMERAL_VALUES ?= ./k8s/helm/crypto-simulator/values-dev-ephemeral.yaml
K8S_HA_VALUES ?= ./k8s/helm/crypto-simulator/values-ha.yaml
K8S_NODEPORT_VALUES ?= ./k8s/helm/crypto-simulator/values-exposure-nodeport.yaml
K8S_LOADBALANCER_VALUES ?= ./k8s/helm/crypto-simulator/values-exposure-lb.yaml
K8S_STATIC_PV_VALUES ?= ./k8s/helm/crypto-simulator/values-static-pv-demo.yaml
K8S_VALUES_EXTRA ?=
K8S_INGRESS_HOST ?= simulator.localtest.me
K8S_INGRESS_PORT ?= 18020
K8S_NODEPORT_HOST_PORT ?= 18021
K8S_UI_NODEPORT ?= 32020
K8S_INGRESS_NGINX_MANIFEST ?= https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml
K8S_METRICS_SERVER_MANIFEST ?= https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
K8S_METALLB_MANIFEST ?= https://raw.githubusercontent.com/metallb/metallb/v0.14.9/config/manifests/metallb-native.yaml
K8S_OPS_BENCHMARK_TOKEN ?= k8s-demo-token
K8S_CORE_TRADING_IMAGE_REPOSITORY ?= crypto-simulator/core-trading
K8S_CORE_TRADING_IMAGE_TAG ?= dev
K8S_DATA_PIPELINE_IMAGE_REPOSITORY ?= crypto-simulator/data-pipeline
K8S_DATA_PIPELINE_IMAGE_TAG ?= dev
K8S_BOT_RUNNER_IMAGE_REPOSITORY ?= crypto-simulator/bot-runner
K8S_BOT_RUNNER_IMAGE_TAG ?= dev
K8S_SIMULATOR_UI_IMAGE_REPOSITORY ?= crypto-simulator/simulator-ui
K8S_SIMULATOR_UI_IMAGE_TAG ?= dev

up:
	docker compose up --build

up-ui-dev:
	docker compose -f docker-compose.yml -f docker-compose.ui-dev.yml up --build

down:
	docker compose down --remove-orphans

down-ui-dev:
	docker compose -f docker-compose.yml -f docker-compose.ui-dev.yml down --remove-orphans

test: test-go test-py test-bot-runner

test-go:
	docker compose build core_trading
	docker compose run --rm --no-deps core_trading sh -lc '/usr/local/go/bin/go test ./...'

test-py:
	docker compose build data_pipeline
	docker compose run --rm --no-deps data_pipeline sh -lc 'if [ -d tests ]; then PYTHONPATH=/app pytest; else echo "No Python tests found."; fi'

test-bot-runner:
	docker compose build bot_runner
	docker compose run --rm --no-deps bot_runner sh -lc 'if [ -d tests ]; then PYTHONPATH=/app pytest; else echo "No Python tests found."; fi'

lint-go:
	docker compose build core_trading
	docker compose run --rm --no-deps core_trading sh -lc 'export PATH=/usr/local/go/bin:$$PATH && apk add --no-cache git >/dev/null && GOBIN=/tmp/bin go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.1.6 && /tmp/bin/golangci-lint run ./...'

lint-py:
	docker compose build data_pipeline
	docker compose run --rm --no-deps data_pipeline sh -lc 'ruff check app tests'

lint-bot-runner:
	docker compose build bot_runner
	docker compose run --rm --no-deps bot_runner sh -lc 'ruff check app tests'

typecheck-ui:
	docker compose -f docker-compose.yml -f docker-compose.ui-e2e.yml run --build --rm --no-deps ui_e2e_runner sh -lc 'npm run typecheck'

lint-ui:
	docker compose -f docker-compose.yml -f docker-compose.ui-e2e.yml run --build --rm --no-deps ui_e2e_runner sh -lc 'npm run lint'

test-ui:
	docker compose -f docker-compose.yml -f docker-compose.ui-e2e.yml run --build --rm --no-deps ui_e2e_runner sh -lc 'npm run test'

build-ui:
	docker compose -f docker-compose.yml -f docker-compose.ui-e2e.yml run --build --rm --no-deps ui_e2e_runner sh -lc 'npm run build'

test-e2e-ui:
	docker compose -f docker-compose.yml -f docker-compose.ui-e2e.yml run --build --rm --no-deps ui_e2e_runner sh -lc 'npm run test:e2e'

test-e2e-ui-live:
	sh ./scripts/test-e2e-ui-live.sh

test-e2e-ui-restore:
	sh ./scripts/test-e2e-ui-restore.sh

migrate-up:
	docker compose up migrations

migrate-down:
	docker compose up -d postgres
	docker compose run --rm migrations -path=/migrations -database=postgres://root:rootpassword@postgres:5432/crypto_sim?sslmode=disable down 1

smoke-paper:
	docker compose up -d --build postgres redis kafka migrations core_trading data_pipeline simulator_ui
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps smoke_runner

smoke-paper-kafka:
	docker compose up -d --build postgres redis kafka migrations core_trading data_pipeline simulator_ui
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps --entrypoint "sh /scripts/smoke-paper-kafka.sh" smoke_runner

smoke-restore:
	docker compose up -d --build postgres redis kafka migrations core_trading data_pipeline simulator_ui
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps --entrypoint "sh /scripts/smoke-session-restore-prepare.sh" smoke_runner
	docker compose restart core_trading
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps --entrypoint "sh /scripts/smoke-session-restore-verify.sh" smoke_runner

smoke-sim-run:
	docker compose up -d --build postgres redis kafka migrations core_trading data_pipeline bot_runner simulator_ui
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps --entrypoint "sh /scripts/smoke-simulation-run.sh" smoke_runner

smoke-sim-experiment:
	docker compose up -d --build postgres redis kafka migrations core_trading data_pipeline bot_runner simulator_ui
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps --entrypoint "sh /scripts/smoke-simulation-experiment.sh" smoke_runner

smoke-ui-runtime:
	docker compose up -d --build postgres redis kafka migrations core_trading data_pipeline simulator_ui
	COMPOSE_PROFILES=ops docker compose run --rm --no-deps --entrypoint "sh /scripts/smoke-ui-runtime.sh" smoke_runner

smoke-ui-dev:
	docker compose -f docker-compose.yml -f docker-compose.ui-dev.yml up -d --build postgres redis kafka migrations core_trading data_pipeline simulator_ui
	COMPOSE_PROFILES=ops docker compose -f docker-compose.yml -f docker-compose.ui-dev.yml run --rm --no-deps --entrypoint "sh /scripts/smoke-ui-dev.sh" smoke_runner

clean-docker:
	docker compose down --remove-orphans

clean-docker-all:
	docker compose down -v --remove-orphans

k8s-kind-up:
	if kind get clusters | grep -qx "$(KIND_CLUSTER_NAME)"; then \
		echo "kind cluster $(KIND_CLUSTER_NAME) already exists"; \
	else \
		kind create cluster --name "$(KIND_CLUSTER_NAME)" --config ./k8s/kind/cluster.yaml; \
	fi
	KIND_CLUSTER_NAME="$(KIND_CLUSTER_NAME)" \
	K8S_INGRESS_NGINX_MANIFEST="$(K8S_INGRESS_NGINX_MANIFEST)" \
	K8S_METRICS_SERVER_MANIFEST="$(K8S_METRICS_SERVER_MANIFEST)" \
	K8S_METALLB_MANIFEST="$(K8S_METALLB_MANIFEST)" \
	sh ./scripts/k8s-bootstrap-addons.sh

k8s-kind-down:
	kind delete cluster --name "$(KIND_CLUSTER_NAME)"

k8s-build-images:
	docker build -f services/core-trading-go/Dockerfile -t "$(K8S_CORE_TRADING_IMAGE_REPOSITORY):$(K8S_CORE_TRADING_IMAGE_TAG)" services/core-trading-go
	docker build -f services/data-pipeline-py/Dockerfile -t "$(K8S_DATA_PIPELINE_IMAGE_REPOSITORY):$(K8S_DATA_PIPELINE_IMAGE_TAG)" services/data-pipeline-py
	docker build -f services/bot-runner-py/Dockerfile -t "$(K8S_BOT_RUNNER_IMAGE_REPOSITORY):$(K8S_BOT_RUNNER_IMAGE_TAG)" services/bot-runner-py
	docker build -f services/simulator-ui/Dockerfile -t "$(K8S_SIMULATOR_UI_IMAGE_REPOSITORY):$(K8S_SIMULATOR_UI_IMAGE_TAG)" services/simulator-ui

k8s-load-images:
	kind load docker-image "$(K8S_CORE_TRADING_IMAGE_REPOSITORY):$(K8S_CORE_TRADING_IMAGE_TAG)" --name "$(KIND_CLUSTER_NAME)"
	kind load docker-image "$(K8S_DATA_PIPELINE_IMAGE_REPOSITORY):$(K8S_DATA_PIPELINE_IMAGE_TAG)" --name "$(KIND_CLUSTER_NAME)"
	kind load docker-image "$(K8S_BOT_RUNNER_IMAGE_REPOSITORY):$(K8S_BOT_RUNNER_IMAGE_TAG)" --name "$(KIND_CLUSTER_NAME)"
	kind load docker-image "$(K8S_SIMULATOR_UI_IMAGE_REPOSITORY):$(K8S_SIMULATOR_UI_IMAGE_TAG)" --name "$(KIND_CLUSTER_NAME)"

k8s-lint:
	docker run --rm -v "$$PWD":/work -w /work alpine/helm:3.16.4 lint "$(K8S_CHART_DIR)"

k8s-template:
	docker run --rm -v "$$PWD":/work -w /work alpine/helm:3.16.4 template "$(K8S_RELEASE)" "$(K8S_CHART_DIR)" \
		--values "$(K8S_VALUES)" \
		$(foreach file,$(K8S_VALUES_EXTRA),--values "$(file)") \
		--set ingress.host="$(K8S_INGRESS_HOST)" \
		--set exposure.nodePort.port="$(K8S_UI_NODEPORT)" \
		--set opsBenchmark.token="$(K8S_OPS_BENCHMARK_TOKEN)" \
		--set coreTrading.image.repository="$(K8S_CORE_TRADING_IMAGE_REPOSITORY)" \
		--set coreTrading.image.tag="$(K8S_CORE_TRADING_IMAGE_TAG)" \
		--set dataPipeline.image.repository="$(K8S_DATA_PIPELINE_IMAGE_REPOSITORY)" \
		--set dataPipeline.image.tag="$(K8S_DATA_PIPELINE_IMAGE_TAG)" \
		--set botRunner.image.repository="$(K8S_BOT_RUNNER_IMAGE_REPOSITORY)" \
		--set botRunner.image.tag="$(K8S_BOT_RUNNER_IMAGE_TAG)" \
		--set simulatorUi.image.repository="$(K8S_SIMULATOR_UI_IMAGE_REPOSITORY)" \
		--set simulatorUi.image.tag="$(K8S_SIMULATOR_UI_IMAGE_TAG)"

k8s-deploy:
	helm upgrade --install "$(K8S_RELEASE)" "$(K8S_CHART_DIR)" \
		--namespace "$(K8S_NAMESPACE)" \
		--create-namespace \
		--wait \
		--wait-for-jobs \
		--timeout 10m \
		--values "$(K8S_VALUES)" \
		$(foreach file,$(K8S_VALUES_EXTRA),--values "$(file)") \
		--set ingress.host="$(K8S_INGRESS_HOST)" \
		--set exposure.nodePort.port="$(K8S_UI_NODEPORT)" \
		--set opsBenchmark.token="$(K8S_OPS_BENCHMARK_TOKEN)" \
		--set coreTrading.image.repository="$(K8S_CORE_TRADING_IMAGE_REPOSITORY)" \
		--set coreTrading.image.tag="$(K8S_CORE_TRADING_IMAGE_TAG)" \
		--set dataPipeline.image.repository="$(K8S_DATA_PIPELINE_IMAGE_REPOSITORY)" \
		--set dataPipeline.image.tag="$(K8S_DATA_PIPELINE_IMAGE_TAG)" \
		--set botRunner.image.repository="$(K8S_BOT_RUNNER_IMAGE_REPOSITORY)" \
		--set botRunner.image.tag="$(K8S_BOT_RUNNER_IMAGE_TAG)" \
		--set simulatorUi.image.repository="$(K8S_SIMULATOR_UI_IMAGE_REPOSITORY)" \
		--set simulatorUi.image.tag="$(K8S_SIMULATOR_UI_IMAGE_TAG)"

k8s-redeploy-apps: k8s-build-images k8s-load-images k8s-deploy

k8s-status:
	kubectl -n "$(K8S_NAMESPACE)" get pods,svc,ingress,pvc,job,hpa,pdb

k8s-smoke:
	SIMULATOR_INGRESS_HOST="$(K8S_INGRESS_HOST)" SIMULATOR_INGRESS_PORT="$(K8S_INGRESS_PORT)" sh ./scripts/smoke-k8s.sh

k8s-smoke-restore:
	SIMULATOR_INGRESS_HOST="$(K8S_INGRESS_HOST)" SIMULATOR_INGRESS_PORT="$(K8S_INGRESS_PORT)" K8S_NAMESPACE="$(K8S_NAMESPACE)" sh ./scripts/smoke-k8s-restore.sh

k8s-hpa-demo-cpu:
	$(MAKE) k8s-deploy K8S_VALUES_EXTRA="$(K8S_HA_VALUES)"
	K8S_NAMESPACE="$(K8S_NAMESPACE)" K8S_OPS_BENCHMARK_TOKEN="$(K8S_OPS_BENCHMARK_TOKEN)" sh ./scripts/k8s-hpa-demo-cpu.sh

k8s-hpa-demo-memory:
	$(MAKE) k8s-deploy K8S_VALUES_EXTRA="$(K8S_HA_VALUES)"
	K8S_NAMESPACE="$(K8S_NAMESPACE)" K8S_OPS_BENCHMARK_TOKEN="$(K8S_OPS_BENCHMARK_TOKEN)" sh ./scripts/k8s-hpa-demo-memory.sh

k8s-rollout-demo:
	$(MAKE) k8s-deploy K8S_VALUES_EXTRA="$(K8S_HA_VALUES)"
	K8S_NAMESPACE="$(K8S_NAMESPACE)" SIMULATOR_INGRESS_HOST="$(K8S_INGRESS_HOST)" SIMULATOR_INGRESS_PORT="$(K8S_INGRESS_PORT)" sh ./scripts/k8s-rollout-demo.sh

k8s-exposure-nodeport-demo:
	$(MAKE) k8s-deploy K8S_VALUES_EXTRA="$(K8S_NODEPORT_VALUES)"
	SIMULATOR_NODEPORT_HOST_PORT="$(K8S_NODEPORT_HOST_PORT)" sh ./scripts/k8s-exposure-nodeport-demo.sh

k8s-exposure-lb-demo:
	$(MAKE) k8s-deploy K8S_VALUES_EXTRA="$(K8S_LOADBALANCER_VALUES)"
	K8S_NAMESPACE="$(K8S_NAMESPACE)" sh ./scripts/k8s-exposure-lb-demo.sh

k8s-static-pv-demo:
	kubectl apply -f ./k8s/infrastructure/storage/postgres-static-pv.yaml
	kubectl create namespace "$(K8S_NAMESPACE)" --dry-run=client -o yaml | kubectl apply -f -
	kubectl -n "$(K8S_NAMESPACE)" apply -f ./k8s/infrastructure/storage/postgres-static-pvc.yaml
	$(MAKE) k8s-deploy K8S_VALUES_EXTRA="$(K8S_STATIC_PV_VALUES)"
