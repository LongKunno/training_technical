{{- define "crypto-simulator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if contains (include "crypto-simulator.name" .) .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "crypto-simulator.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "crypto-simulator.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.labels" -}}
helm.sh/chart: {{ include "crypto-simulator.chart" . }}
app.kubernetes.io/name: {{ include "crypto-simulator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "crypto-simulator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "crypto-simulator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "crypto-simulator.configMapName" -}}
{{- printf "%s-env" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.secretName" -}}
{{- printf "%s-secret" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.migrationsConfigMapName" -}}
{{- printf "%s-migrations" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.postgresServiceName" -}}
{{- printf "%s-postgres" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.postgresClaimName" -}}
{{- if .Values.postgres.persistence.existingClaim -}}
{{- .Values.postgres.persistence.existingClaim | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "crypto-simulator.postgresServiceName" . -}}
{{- end -}}
{{- end -}}

{{- define "crypto-simulator.redisServiceName" -}}
{{- printf "%s-redis" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.kafkaServiceName" -}}
{{- printf "%s-kafka" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.kafkaClaimName" -}}
{{- if .Values.kafka.persistence.existingClaim -}}
{{- .Values.kafka.persistence.existingClaim | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "crypto-simulator.kafkaServiceName" . -}}
{{- end -}}
{{- end -}}

{{- define "crypto-simulator.coreTradingServiceName" -}}
{{- printf "%s-core-trading" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.dataPipelineServiceName" -}}
{{- printf "%s-data-pipeline" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.simulatorUiServiceName" -}}
{{- printf "%s-simulator-ui" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.botRunnerServiceName" -}}
{{- printf "%s-bot-runner" (include "crypto-simulator.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "crypto-simulator.databaseURI" -}}
{{- printf "postgres://%s:%s@%s:%v/%s?sslmode=disable" .Values.postgres.auth.username .Values.postgres.auth.password (include "crypto-simulator.postgresServiceName" .) .Values.postgres.service.port .Values.postgres.auth.database -}}
{{- end -}}

{{- define "crypto-simulator.pythonDatabaseURI" -}}
{{- printf "postgresql://%s:%s@%s:%v/%s" .Values.postgres.auth.username .Values.postgres.auth.password (include "crypto-simulator.postgresServiceName" .) .Values.postgres.service.port .Values.postgres.auth.database -}}
{{- end -}}

{{- define "crypto-simulator.kafkaBootstrapServers" -}}
{{- printf "%s:%v" (include "crypto-simulator.kafkaServiceName" .) .Values.kafka.service.port -}}
{{- end -}}

{{- define "crypto-simulator.coreTradingBaseURL" -}}
{{- printf "http://%s:%v" (include "crypto-simulator.coreTradingServiceName" .) .Values.coreTrading.service.port -}}
{{- end -}}

{{- define "crypto-simulator.dataPipelineBaseURL" -}}
{{- printf "http://%s:%v" (include "crypto-simulator.dataPipelineServiceName" .) .Values.dataPipeline.service.port -}}
{{- end -}}

{{- define "crypto-simulator.botRunnerBaseURL" -}}
{{- printf "http://%s:%v" (include "crypto-simulator.botRunnerServiceName" .) .Values.botRunner.service.port -}}
{{- end -}}

{{- define "crypto-simulator.simulatorUiServiceType" -}}
{{- if eq .Values.exposure.mode "nodePort" -}}
NodePort
{{- else if eq .Values.exposure.mode "loadBalancer" -}}
LoadBalancer
{{- else -}}
ClusterIP
{{- end -}}
{{- end -}}
