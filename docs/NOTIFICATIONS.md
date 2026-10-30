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

### Context links

Set `APP_URL` to the address you use to open Questarr, for example
`https://questarr.example.com`. Apprise alerts then include a clickable link to
the page associated with the event, in both API and CLI mode. Game releases,
delays, available releases, updates, and download start/completion/failure alerts
open the game's details page, where you can review the game and choose Download.
Operational download alerts open Downloads; settings alerts retain their tab
and section links.

For an installation under `/Questarr`, either set
`APP_URL=https://example.com/Questarr`, or combine `APP_URL=https://example.com`
with `QUESTARR_BASE_PATH=/Questarr`. Use an address reachable from the devices
receiving notifications. Without `APP_URL`, notifications still deliver their
text, but cannot include an absolute context link. Existing game-modal links
are also converted when sent through Apprise. Diagnostic-report dialogs do not
currently have an external deep link.

Apprise passes the link in the message body. Link previews, cards, and buttons
depend on the destination service and its Apprise plugin; a single portable
card/button payload is not available across providers. Configure any supported
presentation options in the provider URL (or in the Apprise server configuration
when using a configuration key). See the
[Apprise provider documentation](https://github.com/caronc/apprise/wiki) for the
options of your service, including Telegram. A preview also depends on whether
the service can access the linked page; an authenticated Questarr page will not
necessarily produce a public preview. The link itself remains usable after login.
