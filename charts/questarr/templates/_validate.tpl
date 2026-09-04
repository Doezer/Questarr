{{/*
Fail fast on value combinations that would silently break the instance.
Included for its side effects at the top of the Deployment template.
*/}}
{{- define "questarr.validateValues" -}}
{{- if gt (int .Values.replicaCount) 1 -}}
{{- fail "replicaCount must be 1: Questarr stores its state in a single SQLite database on a ReadWriteOnce volume, and a second replica would corrupt it." -}}
{{- end -}}
{{- if and .Values.persistence.data.enabled (not (hasPrefix "/app/data/" .Values.questarr.databasePath)) -}}
{{- fail (printf "questarr.databasePath (%s) must live under /app/data, the persisted data directory, or the database is lost on every restart." .Values.questarr.databasePath) -}}
{{- end -}}
{{- $envNames := fromYaml (include "questarr.secretEnvNames" .) -}}
{{- range $name, $value := .Values.questarr.secrets -}}
{{- if not (hasKey $envNames $name) -}}
{{- fail (printf "questarr.secrets has no setting named %q; known settings are: %s." $name (join ", " (sortAlpha (keys $envNames)))) -}}
{{- end -}}
{{- end -}}
{{- $key := .Values.questarr.secrets.credentialsEncryptionKey -}}
{{- if and $key (not (regexMatch "^[0-9a-fA-F]{64}$" $key)) -}}
{{- fail "questarr.secrets.credentialsEncryptionKey must be a 64-character hex string (32 bytes), e.g. `openssl rand -hex 32`." -}}
{{- end -}}
{{- end -}}
