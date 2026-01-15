# Configuration Guide

## Initial Setup

Upon first launch, Questarr will guide you through an initial setup wizard:

1.  **Create Admin Account**: Set up your username and password.
2.  **Configure IGDB**: You **must** provide your IGDB Client ID and Client Secret. These are required for the application to function (game discovery, metadata, search).

### How to get IGDB Credentials

Questarr uses the IGDB API (via Twitch) for game metadata. You need to register a free application to get credentials:

1.  Go to the [Twitch Developer Portal](https://dev.twitch.tv/console)
2.  Register a new application (Name it 'Questarr')
3.  Set Redirect URI to `http://localhost` (or your domain)
4.  Select **'Application Integration'** as the category
5.  Copy the **Client ID**
6.  Click **'New Secret'** to generate and copy your **Client Secret**

## IGDB Configuration

IGDB credentials are mandatory. You can configure them in two ways:

### 1. UI Configuration (Recommended)
*   **Where:** Settings Page → IGDB API
*   **Behavior:** Credentials entered here are stored securely in the database.
*   **Precedence:** Settings configured in the UI **override** any environment variables. This allows you to update keys without restarting the container.

### 2. Environment Variables (not recommended)
*   **Where:** `.env` file or Docker environment variables (`IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`).
*   **Behavior:** Used as a fallback if no credentials are configured in the database.
*   **Status:** The Settings page will show a blue "Environment Variable" badge if these are active.

---

### Download Clients

Connect clients to automate downloads.

**Supported Clients:**
- qBittorrent
- Transmission
- rTorrent
- NZBGet
- sabnzbd

**Setup Instructions:**

1. Go to Settings → Downloaders → Add Downloader
2. Select your client type
3. Enter connection details:
   - **Name**: Display name
   - **Host**: IP or hostname (e.g., `192.168.1.10` or `localhost`)
   - **Port**: Web UI port (default: qBittorrent=8080, Transmission=9091)
   - **Username/Password**: If authentication is enabled
   - **Category/Label**: Optional category for organization
   - **Eventual other settings depending on the downloader**
4. Click "Test Connection"
5. Save

**qBittorrent Setup:**
- Enable Web UI in Tools → Options → Web UI
- Set username and password
- Note the port (default 8080)

**Transmission Setup:**
- Enable RPC in settings
- Set RPC port (default 9091)
- Enable authentication if desired

### Configuring Indexers

Indexers search for game torrents across configured sites.

**Option 1: Prowlarr Sync (Recommended)**
1. Install [Prowlarr](https://prowlarr.com/) separately
2. Configure your indexers in Prowlarr
3. In Questarr, go to Settings → Indexers
4. Click "Sync from Prowlarr"
5. Enter your Prowlarr URL and API key

**Option 2: Manual Configuration**
1. Go to Settings → Indexers → Add Indexer
2. Enter:
   - **Name**: Display name for the indexer
   - **URL**: endpoint (e.g., `https://indexer.com/api`)
   - **API Key**: Your indexer API key
   - **Categories**: Select game categories (usually 4000 for PC Games)
3. Click "Test Connection" to verify
4. Save

### Configure app behavior in Settings → General:

- **Auto-search**: Automatically search for wanted games