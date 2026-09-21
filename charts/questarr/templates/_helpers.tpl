{{/*
Expand the name of the chart.
*/}}
{{- define "questarr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
*/}}
{{- define "questarr.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "questarr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "questarr.labels" -}}
helm.sh/chart: {{ include "questarr.chart" . }}
{{ include "questarr.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "questarr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "questarr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "questarr.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "questarr.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the Secret holding Questarr's optional secret values: the
user-provided one when set, otherwise the one this chart renders.
*/}}
{{- define "questarr.secretName" -}}
{{- if .Values.questarr.existingSecret }}
{{- .Values.questarr.existingSecret }}
{{- else }}
{{- include "questarr.fullname" . }}
{{- end }}
{{- end }}

{{/*
Maps each `questarr.secrets` entry to the environment variable Questarr reads it
from (see server/config.ts). These names are fixed by the application; only the
Secret *key* holding each value is configurable, via questarr.existingSecretKeys.
*/}}
{{- define "questarr.secretEnvNames" -}}
jwtSecret: JWT_SECRET
credentialsEncryptionKey: CREDENTIALS_ENCRYPTION_KEY
igdbClientId: IGDB_CLIENT_ID
igdbClientSecret: IGDB_CLIENT_SECRET
nexusmodsApiKey: NEXUSMODS_API_KEY
{{- end }}

{{/*
Secret key holding a given setting: the configured override, else the
environment variable name. Call with (dict "root" $ "name" "jwtSecret").
*/}}
{{- define "questarr.secretKeyFor" -}}
{{- $envNames := fromYaml (include "questarr.secretEnvNames" .root) }}
{{- $configured := index (default (dict) .root.Values.questarr.existingSecretKeys) .name }}
{{- default (index $envNames .name) $configured }}
{{- end }}

{{/*
True when at least one inline secret value is set, i.e. the chart has a Secret
to render. Empty (falsey) otherwise.
*/}}
{{- define "questarr.hasInlineSecrets" -}}
{{- if not .Values.questarr.existingSecret }}
{{- range $key, $value := .Values.questarr.secrets }}
{{- if $value }}true{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Name of the PVC backing /app/data.
*/}}
{{- define "questarr.dataClaimName" -}}
{{- if .Values.persistence.data.existingClaim }}
{{- .Values.persistence.data.existingClaim }}
{{- else }}
{{- printf "%s-data" (include "questarr.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Normalized base path: leading slash, no trailing slash, "" for the root.
Mirrors normalizeBasePath() in server/config.ts.
*/}}
{{- define "questarr.basePath" -}}
{{- $raw := trim (default "" .Values.questarr.basePath) }}
{{- if and $raw (ne $raw "/") }}
{{- $withSlash := ternary $raw (printf "/%s" $raw) (hasPrefix "/" $raw) }}
{{- trimSuffix "/" $withSlash }}
{{- end }}
{{- end }}
