# Notifications

Open **Settings → Notifications** to choose which events produce in-app alerts
and which are sent through Apprise. Questarr supports external notification
providers through [Apprise](https://github.com/caronc/apprise).

## Update alerts

**Notify for shelved games** and **Notify for completed games** independently
control update and pack/add-on alerts for those statuses. These choices apply to
both in-app and Apprise notifications. Turning them off leaves availability
searches and badges active. Existing installations keep both enabled by default.

## Apprise

Choose CLI mode for notification URLs, or API mode for an Apprise API server.
In API mode, enter the API URL and either a configuration key or notification
URLs. If the server requires a login, also enter its username and password, then
save the configuration.

The password is encrypted and shown as a mask after saving. Keep the masked
value to preserve it, or enter a new password to replace it. API login fields
apply only to API mode. Use HTTPS to protect credentials in transit; the settings
page warns when the API URL uses HTTP.

See [SECRETS.md](SECRETS.md) for credential handling.
