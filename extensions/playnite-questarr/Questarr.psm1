<#
    Questarr integration for Playnite (simplified build).

    Connects a Playnite install to a self-hosted Questarr server and keeps the
    two in step with ONE sync: it flushes queued play sessions, reports which
    games Questarr knows, imports everything Questarr is missing as owned
    games (the first sync backfills the whole library; later syncs only pick
    up new games), sends completion statuses, and sends the GOG/Epic play
    time totals the store plugins hold. Per-session play time is recorded as
    games close.

    Talks only to Questarr's /api/integration surface, authenticating with an
    integration API key minted in Settings -> Integrations.

    Threading: the menu command returns immediately and runs the whole sync in
    a background runspace, because inline work on the menu-action thread
    blocks Playnite's UI (Windows marks it "Not Responding" after ~5 seconds)
    and the progress-dialog route is dead on this build: ActivateGlobalProgress
    accepts a scriptblock delegate but never invokes it. When the background
    sync finishes it posts a Playnite notification with the summary.

    Scope rule: functions invoked through the menu dispatcher can fail to
    resolve module-level variables on this build (a null module variable
    produced an empty import batch and a "cannot index into a null array"
    crash before). Every function therefore uses only parameters and objects
    passed to it. The pure sync core (New-QuestarrSyncWork +
    Invoke-QuestarrSyncCore) never touches ambient state, so it runs in any
    runspace; the background script imports this module and calls it with the
    arguments it was handed. The only module-level state left is the
    playtime start map, used exclusively by the lifecycle hooks, whose scope
    is proven to survive.
#>

$ErrorActionPreference = "Stop"

# Playnite runs on Windows PowerShell 5.1, which still negotiates TLS 1.0 by
# default. Questarr is commonly reverse-proxied behind HTTPS, so opt in to
# TLS 1.2 or every request against such a setup fails at the handshake.
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}
catch {
    # Older frameworks without Tls12 in the enum: nothing to do but continue.
}

# Playnite game id -> UTC start time, filled by OnGameStarted. Hook scope only.
$script:PlayStarts = @{}

function Get-QuestarrConfigPath {
    return (Join-Path $CurrentExtensionDataPath "config.json")
}

<#
    The API key is stored with DPAPI (ConvertFrom-SecureString), which encrypts
    it against the current Windows user account. That keeps the key unreadable
    to other users on the machine and to anything that merely copies the file
    off it. It is not protection against code running as this same user.

    An older config from the upstream build may carry MarkInstalledAsOwned or
    SyncPlayStatus fields; both are ignored on read (play status now rides
    along with every sync).
#>
function Save-QuestarrConfig {
    param(
        [Parameter(Mandatory)] [string] $ServerUrl,
        [Parameter(Mandatory)] [string] $ApiKey,
        [bool] $SyncOnLibraryUpdate = $false,
        [bool] $TrackPlayTime = $false
    )

    if (-not (Test-Path $CurrentExtensionDataPath)) {
        New-Item -ItemType Directory -Path $CurrentExtensionDataPath -Force | Out-Null
    }

    $secured = ConvertTo-SecureString -String $ApiKey -AsPlainText -Force |
        ConvertFrom-SecureString

    $config = [PSCustomObject]@{
        ServerUrl           = $ServerUrl.TrimEnd("/")
        ApiKeyEncrypted     = $secured
        SyncOnLibraryUpdate = $SyncOnLibraryUpdate
        TrackPlayTime       = $TrackPlayTime
    }

    $config | ConvertTo-Json -Depth 4 | Set-Content -Path (Get-QuestarrConfigPath) -Encoding UTF8
}

function Get-QuestarrConfig {
    $path = Get-QuestarrConfigPath
    if (-not (Test-Path $path)) {
        return $null
    }

    try {
        $raw = Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        $__logger.Error("Questarr: unreadable config file: $($_.Exception.Message)")
        return $null
    }

    if (-not $raw.ServerUrl -or -not $raw.ApiKeyEncrypted) {
        return $null
    }

    try {
        $secure = ConvertTo-SecureString -String $raw.ApiKeyEncrypted
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
    catch {
        # DPAPI blobs are bound to the Windows user that wrote them, so this is
        # what a copied config or a different account looks like.
        $__logger.Error("Questarr: stored API key could not be decrypted: $($_.Exception.Message)")
        return $null
    }

    return [PSCustomObject]@{
        ServerUrl           = $raw.ServerUrl
        ApiKey              = $apiKey
        SyncOnLibraryUpdate = [bool]$raw.SyncOnLibraryUpdate
        TrackPlayTime       = [bool]$raw.TrackPlayTime
    }
}

<#
    Single entry point for every Questarr call.
#>
function Invoke-QuestarrApi {
    param(
        [Parameter(Mandatory)] $Config,
        [Parameter(Mandatory)] [string] $Path,
        [string] $Method = "Get",
        $Body = $null,
        [int] $TimeoutSec = 60
    )

    $uri = "$($Config.ServerUrl)/api/integration$Path"
    return Invoke-QuestarrHttpRequest -Uri $uri -ApiKey $Config.ApiKey -Method $Method -Body $Body -TimeoutSec $TimeoutSec
}

<#
    Raw HttpWebRequest, not Invoke-RestMethod: PowerShell forwards X-Api-Key
    across an automatic redirect (unlike Authorization, which HttpWebRequest
    strips on its own), and there is no -PreserveAuthorizationOnRedirect
    equivalent for a custom header -- so a redirect to an arbitrary third-party
    host must never be followed blindly with the key still attached.

    Invoke-RestMethod's own -MaximumRedirection 0 can't help decide this: on
    Windows PowerShell 5.1 it surfaces a blocked redirect as an
    InvalidOperationException with no Response attached at all, so there is no
    way to read the redirect's Location header and tell a same-host scheme
    upgrade (a reverse proxy enforcing https, or a trailing slash) from a
    redirect to somewhere else entirely. HttpWebRequest with
    AllowAutoRedirect = $false instead gives a real WebException carrying the
    3xx response, Location header included, so only a same-host redirect is
    followed (with the API key reattached by hand) and anything else still
    fails exactly the way a refused redirect always has -- including a
    same-host https -> http redirect, which would otherwise downgrade an
    https:// connection to sending the key in cleartext with no renewed
    warning at all.

    The body is encoded to UTF-8 bytes by hand because Invoke-RestMethod on
    PowerShell 5.1 otherwise sends JSON as ISO-8859-1, which mangles any
    non-ASCII game title (Pokemon, Okami, Nier Replicant ...) on the way up --
    writing raw bytes to the request stream here keeps that same fix.
#>
function Invoke-QuestarrHttpRequest {
    param(
        [Parameter(Mandatory)] [string] $Uri,
        [Parameter(Mandatory)] [string] $ApiKey,
        [string] $Method = "Get",
        $Body = $null,
        [int] $TimeoutSec = 60,
        [int] $RedirectsFollowed = 0
    )

    $request = [System.Net.WebRequest]::Create($Uri)
    $request.Method = $Method
    $request.Accept = "application/json"
    $request.Headers.Add("X-Api-Key", $ApiKey)
    $request.Timeout = $TimeoutSec * 1000
    # Timeout only covers getting the response headers; bound reading the body too.
    if ($request -is [System.Net.HttpWebRequest]) { $request.ReadWriteTimeout = $TimeoutSec * 1000 }
    $request.AllowAutoRedirect = $false

    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 6 -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $request.ContentType = "application/json; charset=utf-8"
        $request.ContentLength = $bytes.Length
        $requestStream = $request.GetRequestStream()
        try {
            $requestStream.Write($bytes, 0, $bytes.Length)
        }
        finally {
            $requestStream.Close()
        }
    }

    try {
        $response = $request.GetResponse()
    }
    catch [System.Net.WebException] {
        $webResponse = $_.Exception.Response
        if ($null -ne $webResponse) {
            $status = [int]$webResponse.StatusCode
            if ($status -ge 300 -and $status -lt 400 -and $RedirectsFollowed -lt 1) {
                $location = $webResponse.Headers["Location"]
                $webResponse.Close()
                if ($location) {
                    $originalUri = [Uri]$Uri
                    $redirectUri = [Uri]::new($originalUri, $location)
                    # Same host only, and never downgrade https -> http: an
                    # https:// connection carries no consent to ever send the
                    # key in cleartext, so a same-host redirect to plain http
                    # is exactly as untrusted here as a redirect to a
                    # different host entirely, and falls through to the same
                    # refusal below.
                    $isDowngrade = $originalUri.Scheme -ieq "https" -and $redirectUri.Scheme -ieq "http"
                    if ($redirectUri.Host -ieq $originalUri.Host -and -not $isDowngrade) {
                        return Invoke-QuestarrHttpRequest -Uri $redirectUri.AbsoluteUri -ApiKey $ApiKey `
                            -Method $Method -Body $Body -TimeoutSec $TimeoutSec `
                            -RedirectsFollowed ($RedirectsFollowed + 1)
                    }
                }
            }
        }
        throw
    }

    try {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $text = $reader.ReadToEnd()
    }
    finally {
        $reader.Close()
        $response.Close()
    }

    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return $text | ConvertFrom-Json
}

<#
    PowerShell wraps GetResponse() failures in a MethodInvocationException
    ("Exception calling GetResponse with 0 argument(s)"), whose .Response is
    null; the real WebException sits in InnerException. Without unwrapping,
    every HTTP error surfaces as "could not reach the server".
#>
function Get-QuestarrUnwrappedWebException {
    param([Parameter(Mandatory)] $ErrorRecord)

    $err = $ErrorRecord.Exception
    while ($err -and $err -isnot [System.Net.WebException] -and $err.InnerException) {
        $err = $err.InnerException
    }
    if ($err -is [System.Net.WebException]) { return $err }
    return $null
}

<#
    The response body of a failed request, when there is one. Questarr's
    validation errors (400) carry the exact reasons in this body.
#>
function Get-QuestarrErrorBody {
    param([Parameter(Mandatory)] $ErrorRecord)

    $we = Get-QuestarrUnwrappedWebException $ErrorRecord
    if ($null -eq $we -or $null -eq $we.Response) { return "" }

    try {
        $reader = New-Object System.IO.StreamReader($we.Response.GetResponseStream())
        try { return $reader.ReadToEnd() } finally { $reader.Close() }
    }
    catch {
        return ""
    }
}

<#
    Turns an exception from Invoke-QuestarrHttpRequest into something a user
    can act on. The status code matters here: 401 means the key is wrong,
    which is a very different fix from "the server is unreachable". A 3xx
    means Invoke-QuestarrHttpRequest found a redirect it refused to follow
    (anywhere but the exact same host) -- the API key never got sent there.
#>
function Get-QuestarrErrorMessage {
    param([Parameter(Mandatory)] $ErrorRecord)

    $we = Get-QuestarrUnwrappedWebException $ErrorRecord
    $response = if ($we) { $we.Response } else { $null }
    if ($null -ne $response -and $null -ne $response.StatusCode) {
        $status = [int]$response.StatusCode
        switch ($status) {
            401 { return "Questarr rejected the API key (401). Re-check the key in Settings -> Integrations." }
            403 { return "Questarr refused the request (403)." }
            404 { return "Questarr has no integration API at this address (404). Check the address, and that the server is new enough to expose /api/integration." }
            429 { return "Questarr is rate limiting this client (429). Try again shortly." }
            { $_ -ge 300 -and $_ -lt 400 } {
                return "Questarr tried to redirect this request (HTTP $status), which this extension " +
                    "refuses to follow -- the API key would otherwise be forwarded to whatever address the " +
                    "redirect points at. Check the configured server address in Settings -> Integrations."
            }
            default { return "Questarr returned HTTP $status. $($ErrorRecord.Exception.Message)" }
        }
    }

    if ($null -eq $we) {
        # Not an HTTP failure at all (a file or argument error, for example).
        return "Questarr sync operation failed: $($ErrorRecord.Exception.Message)"
    }

    return "Could not reach Questarr at the configured address. $($ErrorRecord.Exception.Message)"
}

function Get-QuestarrConfigOrWarn {
    $config = Get-QuestarrConfig
    if ($null -eq $config) {
        $PlayniteApi.Dialogs.ShowErrorMessage(
            "Questarr is not configured yet. Use Extensions -> Questarr -> Connect to Questarr first.",
            "Questarr")
        return $null
    }
    return $config
}

# -- Menu wiring --------------------------------------------------------------

function GetMainMenuItems {
    param($getMainMenuItemsArgs)

    $config = Get-QuestarrConfig
    $autoState = if ($config -and $config.SyncOnLibraryUpdate) { "ON" } else { "OFF" }
    $playState = if ($config -and $config.TrackPlayTime) { "ON" } else { "OFF" }

    $items = @()

    $connect = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $connect.Description = "Connect to Questarr..."
    $connect.FunctionName = "Invoke-QuestarrConnect"
    $connect.MenuSection = "@Questarr"
    $items += $connect

    $sync = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $sync.Description = "Sync library to Questarr (runs in the background)"
    $sync.FunctionName = "Invoke-QuestarrLibrarySync"
    $sync.MenuSection = "@Questarr"
    $items += $sync

    $toggle = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $toggle.Description = "Toggle automatic sync on library update (currently $autoState)"
    $toggle.FunctionName = "Invoke-QuestarrToggleAutoSync"
    $toggle.MenuSection = "@Questarr"
    $items += $toggle

    $track = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $track.Description = "Toggle sending finished play sessions to Questarr (currently $playState)"
    $track.FunctionName = "Invoke-QuestarrToggleTrackPlayTime"
    $track.MenuSection = "@Questarr"
    $items += $track

    return $items
}

function GetGameMenuItems {
    param($getGameMenuItemsArgs)

    $request = New-Object Playnite.SDK.Plugins.ScriptGameMenuItem
    $request.Description = "Request on Questarr"
    $request.FunctionName = "Invoke-QuestarrRequestGame"
    $request.MenuSection = "Questarr"

    return @($request)
}

# -- Actions ------------------------------------------------------------------

<#
    Whether $HostName names a machine on the caller's own local network rather
    than somewhere out on the internet: loopback, an RFC1918/link-local IP
    literal, or a hostname with no dot / an mDNS ".local" suffix (the two
    conventions actual home-network devices use -- "questarr", "nas",
    "questarr.local").

    A plain-HTTP address always gets a warn-and-continue choice rather than
    being refused outright -- this only decides how alarming that warning's
    wording is ("your own network" vs "outside your network, on the open
    internet"). It only has to be right about "this clearly isn't a local
    address", not perfectly classify every address, so a literal IP is
    checked precisely and a bare hostname is judged by convention rather than
    resolved over the network.
#>
function Test-QuestarrIsPrivateHost {
    param([Parameter(Mandatory)] [string] $HostName)

    if ($HostName -ieq "localhost") { return $true }

    $ip = $null
    if ([System.Net.IPAddress]::TryParse($HostName, [ref]$ip)) {
        if ([System.Net.IPAddress]::IsLoopback($ip)) { return $true }

        $bytes = $ip.GetAddressBytes()
        if ($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
            # 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 (link-local)
            if ($bytes[0] -eq 10) { return $true }
            if ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) { return $true }
            if ($bytes[0] -eq 192 -and $bytes[1] -eq 168) { return $true }
            if ($bytes[0] -eq 169 -and $bytes[1] -eq 254) { return $true }
            return $false
        }
        # IPv6: unique local (fc00::/7) and link-local (fe80::/10)
        if (($bytes[0] -band 0xfe) -eq 0xfc) { return $true }
        if ($bytes[0] -eq 0xfe -and ($bytes[1] -band 0xc0) -eq 0x80) { return $true }
        return $false
    }

    # Not an IP literal: judge by the two conventions local-network devices
    # actually use, rather than spending a DNS round-trip on every Connect.
    return ($HostName -notlike "*.*") -or ($HostName -ilike "*.local")
}

function Invoke-QuestarrConnect {
    param($scriptMainMenuItemActionArgs)

    $existing = Get-QuestarrConfig
    $defaultUrl = if ($existing) { $existing.ServerUrl } else { "http://localhost:5000" }

    $urlResult = $PlayniteApi.Dialogs.SelectString(
        "Questarr server address (including http:// or https://):", "Questarr", $defaultUrl)
    if (-not $urlResult.Result) { return }

    $serverUrl = $urlResult.SelectedString.Trim()
    if ([string]::IsNullOrWhiteSpace($serverUrl)) {
        $PlayniteApi.Dialogs.ShowErrorMessage("A server address is required.", "Questarr")
        return
    }

    $parsedUri = $null
    if (-not [Uri]::TryCreate($serverUrl, [UriKind]::Absolute, [ref]$parsedUri) -or
        $parsedUri.Scheme -notin @("http", "https")) {
        $PlayniteApi.Dialogs.ShowErrorMessage(
            "'$serverUrl' is not a valid http:// or https:// address.", "Questarr")
        return
    }

    # Never a hard stop: it's the user's server and their call to make. But the
    # API key is a long-lived credential sent on every sync or request, unlike
    # a password typed once, so plain http:// always gets an explicit, loud
    # warning before it can proceed -- worded more strongly the further the
    # address is from "this is obviously just my own LAN".
    #
    # DnsSafeHost, not Host: Host keeps the [brackets] around an IPv6 literal,
    # which [System.Net.IPAddress]::TryParse inside Test-QuestarrIsPrivateHost
    # rejects outright -- that falls through to the hostname heuristic, which
    # would otherwise misclassify a public IPv6 address as local.
    if ($parsedUri.Scheme -eq "http") {
        $isLocal = $parsedUri.IsLoopback -or (Test-QuestarrIsPrivateHost $parsedUri.DnsSafeHost)
        $scopeWarning = if ($isLocal) {
            "'$serverUrl' is a plain http:// address on your local network."
        }
        else {
            "'$serverUrl' is a plain http:// address OUTSIDE your local network. " +
            "This is considerably riskier than a same-network address: the traffic can " +
            "cross the open internet in cleartext."
        }

        $proceed = $PlayniteApi.Dialogs.ShowMessage(
            "$scopeWarning`n`n" +
            "WARNING: your Questarr API key will be sent UNENCRYPTED on every sync or " +
            "request. Anyone able to observe this traffic -- on this network, or anywhere " +
            "between here and the server if it's remote -- can capture the key and use it " +
            "to read and modify your library.`n`n" +
            "Use an https:// address instead whenever you can (e.g. behind a reverse " +
            "proxy). Continue with plain http:// anyway?",
            "Questarr - Security Warning",
            [System.Windows.MessageBoxButton]::YesNo)
        if ($proceed -ne [System.Windows.MessageBoxResult]::Yes) { return }
    }

    $keyResult = $PlayniteApi.Dialogs.SelectString(
        "Questarr API key (Settings -> Integrations -> API Keys):", "Questarr", "")
    if (-not $keyResult.Result) { return }

    $apiKey = $keyResult.SelectedString.Trim()
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        $PlayniteApi.Dialogs.ShowErrorMessage("An API key is required.", "Questarr")
        return
    }

    $probe = [PSCustomObject]@{ ServerUrl = $serverUrl.TrimEnd("/"); ApiKey = $apiKey }

    try {
        $ping = Invoke-QuestarrApi -Config $probe -Path "/ping" -TimeoutSec 20
    }
    catch {
        $PlayniteApi.Dialogs.ShowErrorMessage((Get-QuestarrErrorMessage $_), "Questarr")
        return
    }

    # /ping also accepts read-only and other-purpose keys, but syncs and requests
    # would then fail with 403 on every run. Older servers send no scope field.
    if ($ping.scope -and $ping.scope -notin @("library:write", "all")) {
        $PlayniteApi.Dialogs.ShowErrorMessage(
            "This API key has the access '$($ping.scope)', which cannot sync or request games. " +
            "Create a key with the 'Library sync (Playnite)' access in Questarr (Settings -> Integrations -> API Keys).",
            "Questarr")
        return
    }

    # Only persist a credential that has actually been proven to work.
    Save-QuestarrConfig `
        -ServerUrl $serverUrl `
        -ApiKey $apiKey `
        -SyncOnLibraryUpdate $(if ($existing) { $existing.SyncOnLibraryUpdate } else { $false }) `
        -TrackPlayTime $(if ($existing) { $existing.TrackPlayTime } else { $false })

    $PlayniteApi.Dialogs.ShowMessage(
        "Connected to Questarr $($ping.version) as $($ping.authenticatedAs.username).",
        "Questarr")
}

function Invoke-QuestarrToggleAutoSync {
    param($scriptMainMenuItemActionArgs)

    $config = Get-QuestarrConfigOrWarn
    if ($null -eq $config) { return }

    $enabled = -not $config.SyncOnLibraryUpdate
    Save-QuestarrConfig `
        -ServerUrl $config.ServerUrl `
        -ApiKey $config.ApiKey `
        -SyncOnLibraryUpdate $enabled `
        -TrackPlayTime $config.TrackPlayTime

    $state = if ($enabled) { "enabled" } else { "disabled" }
    $PlayniteApi.Dialogs.ShowMessage(
        "Automatic sync on library update is now $state. The automatic sync is the same background push as the menu command: it adds new games, sends play status and play time totals.",
        "Questarr")
}

function Invoke-QuestarrToggleTrackPlayTime {
    param($scriptMainMenuItemActionArgs)

    $config = Get-QuestarrConfigOrWarn
    if ($null -eq $config) { return }

    $enabled = -not $config.TrackPlayTime
    Save-QuestarrConfig `
        -ServerUrl $config.ServerUrl `
        -ApiKey $config.ApiKey `
        -SyncOnLibraryUpdate $config.SyncOnLibraryUpdate `
        -TrackPlayTime $enabled

    $state = if ($enabled) { "enabled" } else { "disabled" }
    $PlayniteApi.Dialogs.ShowMessage(
        "Finished-play-session tracking is now $state. This records each session when a game closes. " +
        "GOG/Epic play-time totals are sent by every library sync regardless of this setting.", "Questarr")
}

# -- Store metadata (local constants only) ------------------------------------

<#
    Steam is the one Playnite library whose GameId maps cleanly onto an
    identifier Questarr also stores, so it gets an exact match instead of a
    title comparison. Returns 0 for any other game.
#>
function Get-QuestarrSteamAppId {
    param($Game)

    if ($Game.PluginId -eq [Guid]"cb91dfc9-b977-43bf-8e70-55f46e410fab") {
        $steamAppId = 0
        if ([int]::TryParse($Game.GameId, [ref]$steamAppId) -and $steamAppId -gt 0) {
            return $steamAppId
        }
    }
    return 0
}

function Format-QuestarrUtc {
    param([DateTime] $Value)

    return $Value.ToUniversalTime().ToString(
        "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
}

# -- The pure sync core (runs in any runspace; no ambient state) ---------------

<#
    Builds everything the sync needs from objects passed in, so the core can
    run inside a background runspace with no Playnite ambient variables.
    Everything the core touches afterwards is inside this object: paths,
    payloads and the config.

    -Api    Playnite's API object, used only here to read the games database.
    -Config the saved extension config.
    -DataDir the extension data directory, resolved by the caller.
#>
function New-QuestarrSyncWork {
    param(
        [Parameter(Mandatory)] $Api,
        [Parameter(Mandatory)] $Config,
        [Parameter(Mandatory)] [string] $DataDir
    )

    $syncEntries = New-Object System.Collections.ArrayList
    $statusEntries = New-Object System.Collections.ArrayList
    $gogTotals = New-Object System.Collections.ArrayList
    $epicTotals = New-Object System.Collections.ArrayList
    $excluded = 0

    $steamGuid = [Guid]"cb91dfc9-b977-43bf-8e70-55f46e410fab"
    $gogGuid = [Guid]"aebe8b7c-6dc3-4a66-af31-e7375c6b5e9e"
    $epicGuid = [Guid]"00000002-dbd1-46c6-b5d0-b1ba559d10e4"

    foreach ($game in $Api.Database.Games) {
        if ([string]::IsNullOrWhiteSpace($game.Name)) { continue }

        # Two kinds of title are not worth sending anywhere: one longer than
        # the server's 500-character limit (a single such entry would make it
        # reject the whole batch), and one with no letter or digit at all,
        # which the server's normalizer flattens to an empty key that matches
        # any other such title.
        $title = $game.Name.Trim()
        if ($title.Length -gt 500 -or $title -notmatch "[\p{L}\p{Nd}]") {
            $excluded += 1
            continue
        }

        $steamAppId = 0
        if ($game.PluginId -eq $steamGuid) {
            $parsed = 0
            if ([int]::TryParse($game.GameId, [ref]$parsed) -and $parsed -gt 0) {
                $steamAppId = $parsed
            }
        }
        $platform = ""
        if ($game.PluginId -eq $steamGuid) { $platform = "steam" }
        elseif ($game.PluginId -eq $gogGuid) { $platform = "gog" }
        elseif ($game.PluginId -eq $epicGuid) { $platform = "epic" }

        $syncEntry = @{
            title      = $title
            externalId = $game.Id.ToString()
            installed  = [bool]$game.IsInstalled
        }
        if ($steamAppId -gt 0) { $syncEntry.steamAppId = $steamAppId }
        if ($platform) { $syncEntry.platform = $platform }
        [void]$syncEntries.Add($syncEntry)

        # Play status: only games that have a completion status in Playnite.
        $statusName = ""
        if ($null -ne $game.CompletionStatus) {
            $statusName = [string]$game.CompletionStatus.Name
        }
        if (-not [string]::IsNullOrWhiteSpace($statusName) -and
            $statusName.Length -le 100 -and $title.Length -le 500) {
            $statusEntry = @{
                title      = $title
                externalId = $game.Id.ToString()
                status     = $statusName
            }
            if ($platform) { $statusEntry.platform = $platform }
            if ($steamAppId -gt 0) { $statusEntry.steamAppId = $steamAppId }
            [void]$statusEntries.Add($statusEntry)
        }

        # Play time totals: per store, at least ten minutes recorded.
        if (($game.PluginId -eq $gogGuid -or $game.PluginId -eq $epicGuid) -and
            [uint64]$game.Playtime -ge 600 -and $title.Length -le 500) {
            $totalEntry = @{
                title           = $title
                externalId      = $game.Id.ToString()
                playtimeSeconds = [int64][Math]::Min([uint64]$game.Playtime, 100000000)
            }
            if ($null -ne $game.LastActivity) {
                $totalEntry.lastPlayedAt = Format-QuestarrUtc $game.LastActivity
            }
            if ($game.PluginId -eq $gogGuid) { [void]$gogTotals.Add($totalEntry) }
            else { [void]$epicTotals.Add($totalEntry) }
        }
    }

    return [PSCustomObject]@{
        Config        = $Config
        DataDir       = $DataDir
        SyncEntries   = $syncEntries
        StatusEntries = $statusEntries
        GogTotals     = $gogTotals
        EpicTotals    = $epicTotals
        Excluded      = $excluded
    }
}

function Read-QuestarrPlayQueueFile {
    param([Parameter(Mandatory)] [string] $DataDir)

    $path = Join-Path $DataDir "play-sessions-queue.json"
    if (-not (Test-Path $path)) { return @() }

    try {
        $raw = Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        return @()
    }
    if ($null -eq $raw) { return @() }
    return @($raw)
}

function Write-QuestarrPlayQueueFile {
    param(
        [Parameter(Mandatory)] [string] $DataDir,
        $Items
    )

    $path = Join-Path $DataDir "play-sessions-queue.json"
    $list = @($Items)
    if ($list.Count -gt 200) {
        $list = @($list | Select-Object -Last 200)
    }
    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    }
    $temp = "$path.tmp"
    ConvertTo-Json -InputObject $list -Depth 4 | Set-Content -Path $temp -Encoding UTF8
    if (Test-Path $path) {
        # PS 5.1 turns a $null backup path into an empty string, which
        # File.Replace rejects ("The path is not of a legal form");
        # [NullString]::Value passes a true null.
        [System.IO.File]::Replace($temp, $path, [NullString]::Value)
    }
    else {
        Move-Item -Path $temp -Destination $path
    }
}

<#
    A named mutex serializes every queue file mutation between the lifecycle
    hooks, the menu thread and the background runspace (all in this process,
    plus any second Playnite window): reads and writes of the queue never
    interleave, so a session queued while a flush is running cannot be
    clobbered by its write-back.
#>
function Get-QuestarrQueueMutex {
    return New-Object System.Threading.Mutex($false, "Global\PlayniteQuestarrPlayQueue")
}

function Wait-QuestarrQueueMutex {
    param(
        [Parameter(Mandatory)] [System.Threading.Mutex] $Mutex,
        [int] $Seconds = 10
    )

    try {
        return $Mutex.WaitOne([TimeSpan]::FromSeconds($Seconds))
    }
    catch [System.Threading.AbandonedMutexException] {
        # The previous holder died without releasing; the mutex is held now.
        return $true
    }
}

<#
    Appends one finished session to the queue under the mutex. Returns $true
    when the entry is safely on disk.
#>
function Add-QuestarrQueuedSession {
    param(
        [Parameter(Mandatory)] [string] $DataDir,
        [Parameter(Mandatory)] $Entry
    )

    $mutex = Get-QuestarrQueueMutex
    $acquired = $false
    try {
        $acquired = Wait-QuestarrQueueMutex $Mutex
        if (-not $acquired) { return $false }
        $queue = @(Read-QuestarrPlayQueueFile -DataDir $DataDir)
        Write-QuestarrPlayQueueFile -DataDir $DataDir -Items ($queue + $Entry)
        return $true
    }
    finally {
        if ($acquired) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

<#
    Drains the queue: snapshots it under the mutex, sends each entry OUTSIDE
    the lock (network waits never hold it), then re-takes the lock, re-reads
    the file and removes only the entries actually acknowledged or
    permanently rejected. A session appended while the sends were running
    stays on disk untouched.

    Returns @{ Sent; Dropped; Remaining }: Sent are accepted by Questarr,
    Dropped are permanently rejected (unknown game and the like), Remaining
    are still queued. A transient failure stops the drain early and leaves
    everything unsent on disk; the server dedupes a re-sent session by its
    start time, so a duplicate send is harmless.
#>
function Invoke-QuestarrQueueDrain {
    param(
        [Parameter(Mandatory)] $Config,
        [Parameter(Mandatory)] [string] $DataDir
    )

    $result = @{ Sent = 0; Dropped = 0; Remaining = 0 }
    $mutex = Get-QuestarrQueueMutex
    try {
        if (-not (Wait-QuestarrQueueMutex $Mutex)) {
            # Someone else holds the queue; leave the file alone and report
            # everything as remaining, the next drain retries.
            $result.Remaining = @(Read-QuestarrPlayQueueFile -DataDir $DataDir).Count
            return $result
        }
        $snapshot = $null
        try { $snapshot = @(Read-QuestarrPlayQueueFile -DataDir $DataDir) }
        finally { $mutex.ReleaseMutex() }

        $sends = New-Object System.Collections.ArrayList
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $stopped = $false
        foreach ($entry in $snapshot) {
            if (-not $stopped -and [DateTime]::UtcNow -ge $deadline) { $stopped = $true }
            if ($stopped) { break }
            $outcome = Send-QuestarrPlaySession -Config $Config -Entry $entry
            if ($outcome -eq "retry") { break }
            [void]$sends.Add(@{ Key = "$($entry.title)|$($entry.startedAt)|$($entry.endedAt)"; Outcome = $outcome })
        }

        if (-not (Wait-QuestarrQueueMutex $Mutex)) {
            # Acknowledged entries stay queued and will be re-sent later; the
            # server's start-time dedup makes that harmless.
            $result.Remaining = @(Read-QuestarrPlayQueueFile -DataDir $DataDir).Count
            return $result
        }
        try {
            $latest = @(Read-QuestarrPlayQueueFile -DataDir $DataDir)
            $sentKeys = @{}
            $droppedKeys = @{}
            foreach ($s in $sends) {
                if ($s.Outcome -eq "sent") { $sentKeys[$s.Key] = $true }
                elseif ($s.Outcome -eq "skipped") { $droppedKeys[$s.Key] = $true }
            }
            $keep = New-Object System.Collections.ArrayList
            foreach ($entry in $latest) {
                $key = "$($entry.title)|$($entry.startedAt)|$($entry.endedAt)"
                if ($sentKeys.ContainsKey($key) -or $droppedKeys.ContainsKey($key)) { continue }
                [void]$keep.Add($entry)
            }
            Write-QuestarrPlayQueueFile -DataDir $DataDir -Items $keep.ToArray()
            $result.Sent = $sentKeys.Count
            $result.Dropped = $droppedKeys.Count
            $result.Remaining = $keep.Count
        }
        finally { $mutex.ReleaseMutex() }
    }
    finally {
        $mutex.Dispose()
    }
    return $result
}

<#
    Sends one finished session. Returns "sent", "skipped" (the server will never
    accept it) or "retry" (worth trying again later).
#>
function Send-QuestarrPlaySession {
    param(
        [Parameter(Mandatory)] $Config,
        [Parameter(Mandatory)] $Entry
    )

    $body = @{
        title     = $Entry.title
        startedAt = $Entry.startedAt
        endedAt   = $Entry.endedAt
    }
    if ($Entry.steamAppId -and [int]$Entry.steamAppId -gt 0) {
        $body.steamAppId = [int]$Entry.steamAppId
    }

    try {
        Invoke-QuestarrApi -Config $Config -Path "/play-sessions" -Method "Post" -Body $body `
            -TimeoutSec 10 | Out-Null
        return "sent"
    }
    catch {
        $we = Get-QuestarrUnwrappedWebException $_
        $response = if ($we) { $we.Response } else { $null }
        $status = if ($null -ne $response) { [int]$response.StatusCode } else { 0 }

        if ($status -eq 404) {
            $text = ""
            try {
                $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
                try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
            }
            catch { }
            if ($text -match '"code"\s*:\s*"GAME_NOT_FOUND"') { return "skipped" }
            return "retry"
        }
        if ($status -ge 400 -and $status -lt 500 -and $status -notin 401, 403, 408, 429) {
            return "skipped"
        }
        return "retry"
    }
}

<#
    Titles the server could not match on IGDB, cached by Playnite game id so
    later syncs do not pay the lookup again. The value is the title that was
    tried: a cached miss only stands while the Playnite title stays the same,
    so correcting a mistyped name reaches IGDB again on the next sync.
    An older build wrote a plain array of ids; those entries carry no title
    and keep their original skip-unconditionally behaviour.
#>
function Read-QuestarrImportSkipList {
    param([Parameter(Mandatory)] [string] $DataDir)

    $path = Join-Path $DataDir "import-skip.json"
    if (-not (Test-Path $path)) { return @{} }
    try {
        $raw = Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -eq $raw) { return @{} }
        $map = @{}
        if ($raw -is [System.Array]) {
            foreach ($id in @($raw)) {
                if ($id) { $map[[string]$id] = $null }
            }
            return $map
        }
        foreach ($p in $raw.PSObject.Properties) {
            $map[$p.Name] = [string]$p.Value
        }
        return $map
    }
    catch {
        return @{}
    }
}

function Write-QuestarrImportSkipList {
    param(
        [Parameter(Mandatory)] [string] $DataDir,
        $Map
    )

    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    }
    $path = Join-Path $DataDir "import-skip.json"
    $temp = "$path.tmp"
    ConvertTo-Json -InputObject $Map -Depth 3 | Set-Content -Path $temp -Encoding UTF8
    if (Test-Path $path) {
        [System.IO.File]::Replace($temp, $path, [NullString]::Value)
    }
    else {
        Move-Item -Path $temp -Destination $path
    }
}

<#
    The one recurring push. Pure: everything it touches arrives in $Work, so
    it runs identically on the menu thread, a hook thread, or a background
    runspace. Sections, in order:

    1. drain queued play sessions (a store total sent before a queued session
       lands would count that session twice),
    2. reconcile the library: which games Questarr knows, and their Questarr
       game ids,
    3. import everything Questarr does not know yet, as owned games -- the
       first run backfills the whole library, later runs only pick up new
       games; IGDB-unmatchable titles are cached (with the title that was
       tried) and skipped afterwards,
    4. play statuses, matched by Questarr game id when the id is known,
    5. GOG/Epic play time totals -- deferred while sessions are still queued,
       since Questarr dedupes actual sessions against each other but not
       against store-total estimates.

    Each section is independent: one failing never hides the results of the
    others; every successful batch updates the report immediately, so a later
    failure never erases earlier results.
#>
function Invoke-QuestarrSyncCore {
    param([Parameter(Mandatory)] $Work)

    $Config = $Work.Config
    $DataDir = $Work.DataDir

    $report = @{
        Games           = 0
        Known           = 0
        NewlyAdded      = 0
        ImportExisting  = 0
        NotMatched      = 0
        StatusEntries   = 0
        Updated         = 0
        Unchanged       = 0
        StatusSkipped   = 0
        StatusUnmatched = 0
        SessionsSent    = 0
        SessionsDropped = 0
        Totals          = @{}
        TotalsDeferred  = 0
        Excluded        = [int]$Work.Excluded
        Errors          = (New-Object System.Collections.ArrayList)
    }

    # Playnite game id -> Questarr game id, learned from the reconciliation
    # and import responses; the status section uses it to match by the exact
    # game instead of a title an edition suffix could throw off.
    $gameIds = @{}
    $queueRemaining = 0

    # 1. queued play sessions first.
    try {
        $drain = Invoke-QuestarrQueueDrain -Config $Config -DataDir $DataDir
        $report.SessionsSent = $drain.Sent
        $report.SessionsDropped = $drain.Dropped
        $queueRemaining = $drain.Remaining
    }
    catch {
        [void]$report.Errors.Add("play sessions: $(Get-QuestarrErrorMessage $_)")
        $queueRemaining = @(Read-QuestarrPlayQueueFile -DataDir $DataDir).Count
    }

    # 2 + 3. reconcile, then import what is missing.
    try {
        $entries = $Work.SyncEntries
        $report.Games = $entries.Count

        $byId = @{}
        foreach ($e in $entries) { $byId[[string]$e.externalId] = $e }

        $missingIds = New-Object System.Collections.ArrayList
        if ($entries.Count -gt 0) {
            $size = 500
            for ($offset = 0; $offset -lt $entries.Count; $offset += $size) {
                $take = [Math]::Min($size, $entries.Count - $offset)
                $batch = @($entries.GetRange($offset, $take))
                $response = Invoke-QuestarrApi -Config $Config -Path "/library/sync" -Method "Post" -Body @{
                    games                = $batch
                    markInstalledAsOwned = $false
                }
                $report.Known += @($response.matched).Count
                foreach ($m in @($response.matched)) {
                    if ($m.externalId -and $m.gameId) {
                        $gameIds[[string]$m.externalId] = [string]$m.gameId
                    }
                }
                foreach ($u in @($response.unmatched)) {
                    if ($u.externalId) { [void]$missingIds.Add([string]$u.externalId) }
                }
            }
        }

        if ($missingIds.Count -gt 0) {
            $skip = Read-QuestarrImportSkipList -DataDir $DataDir
            $toImport = New-Object System.Collections.ArrayList
            foreach ($id in $missingIds) {
                $source = $byId[$id]
                if (-not $source) { continue }
                if ($skip.ContainsKey($id)) {
                    # A cached miss stands only while the Playnite title is
                    # unchanged: a corrected title reaches IGDB again.
                    $cachedTitle = $skip[$id]
                    if ($null -eq $cachedTitle -or $cachedTitle -eq $source.title) { continue }
                }
                [void]$toImport.Add($source)
            }

            if ($toImport.Count -gt 0) {
                $notFoundIds = New-Object System.Collections.ArrayList
                $size = 25
                for ($offset = 0; $offset -lt $toImport.Count; $offset += $size) {
                    $take = [Math]::Min($size, $toImport.Count - $offset)
                    $batch = @($toImport.GetRange($offset, $take))
                    if ($batch.Count -eq 0) { continue }
                    $response = Invoke-QuestarrApi -Config $Config -Path "/library/import" -Method "Post" `
                        -Body @{ games = $batch } -TimeoutSec 300
                    # Published immediately: a later batch failing must not
                    # erase the games an earlier batch already added.
                    $report.NewlyAdded += [int]$response.added
                    $report.ImportExisting += [int]$response.existing
                    $report.NotMatched += [int]$response.notFound
                    foreach ($r in @($response.results)) {
                        if ($r.externalId -and $r.gameId) {
                            $gameIds[[string]$r.externalId] = [string]$r.gameId
                        }
                        if ($r.result -eq "not_found" -and $r.externalId) {
                            [void]$notFoundIds.Add([string]$r.externalId)
                        }
                    }
                }
                if ($notFoundIds.Count -gt 0) {
                    foreach ($id in $notFoundIds) {
                        $source = $byId[$id]
                        $skip[$id] = if ($source) { [string]$source.title } else { "" }
                    }
                    Write-QuestarrImportSkipList -DataDir $DataDir -Map $skip
                }
            }
            else {
                $report.NotMatched = $missingIds.Count
            }
        }
    }
    catch {
        [void]$report.Errors.Add("library import: $(Get-QuestarrErrorMessage $_)")
    }

    # 4. play status, matched by Questarr game id whenever one is known.
    try {
        $statuses = $Work.StatusEntries
        $report.StatusEntries = $statuses.Count
        if ($statuses.Count -gt 0) {
            $size = 500
            for ($offset = 0; $offset -lt $statuses.Count; $offset += $size) {
                $take = [Math]::Min($size, $statuses.Count - $offset)
                $batch = @($statuses.GetRange($offset, $take) | ForEach-Object {
                    $gid = $gameIds[[string]$_.externalId]
                    if ($gid) {
                        $copy = $_.Clone()
                        $copy.gameId = $gid
                        $copy
                    }
                    else { $_ }
                })
                $response = Invoke-QuestarrApi -Config $Config -Path "/play-status" -Method "Post" -Body @{
                    games         = $batch
                    promoteWanted = $false
                } -TimeoutSec 300
                $report.Updated += [int]$response.updated
                $report.Unchanged += [int]$response.unchanged
                $report.StatusSkipped += [int]$response.skipped
                $report.StatusUnmatched += [int]$response.unmatched
            }
        }
    }
    catch {
        [void]$report.Errors.Add("play status: $(Get-QuestarrErrorMessage $_)")
    }

    # 5. store play time totals, unless sessions are still waiting: Questarr
    #    dedupes actual sessions against each other but not against these
    #    estimates, so sending a total while its session is queued would count
    #    that play time twice once the session lands.
    if ($queueRemaining -gt 0) {
        $report.TotalsDeferred = $queueRemaining
    }
    else {
        foreach ($store in @(@{ label = "GOG"; entries = $Work.GogTotals },
                              @{ label = "Epic"; entries = $Work.EpicTotals })) {
            try {
                if ($store.entries.Count -gt 0) {
                    $report.Totals[$store.label] = @{
                        Imported  = 0
                        Unchanged = 0
                        Skipped   = 0
                        Unmatched = 0
                        Minutes   = 0
                    }
                    $size = 500
                    for ($offset = 0; $offset -lt $store.entries.Count; $offset += $size) {
                        $take = [Math]::Min($size, $store.entries.Count - $offset)
                        $batch = @($store.entries.GetRange($offset, $take))
                        $response = Invoke-QuestarrApi -Config $Config -Path "/play-time-totals" -Method "Post" -Body @{
                            games = $batch
                        } -TimeoutSec 300
                        $t = $report.Totals[$store.label]
                        $t.Imported += [int]$response.imported
                        $t.Unchanged += [int]$response.unchanged
                        $t.Skipped += [int]$response.skipped
                        $t.Unmatched += [int]$response.unmatched
                        $t.Minutes += [int]$response.minutesAdded
                    }
                }
            }
            catch {
                [void]$report.Errors.Add("$($store.label) play time: $(Get-QuestarrErrorMessage $_)")
            }
        }
    }

    return [PSCustomObject]$report
}

<#
    One summary line for notifications and logs.
#>
function Get-QuestarrSyncSummary {
    param([Parameter(Mandatory)] $Report)

    $parts = New-Object System.Collections.ArrayList
    [void]$parts.Add(("{0} games: {1} known, {2} newly owned, {3} no IGDB match" -f `
            $Report.Games, $Report.Known, $Report.NewlyAdded, $Report.NotMatched))
    if ($Report.Excluded -gt 0) {
        [void]$parts.Add("$($Report.Excluded) excluded (overlong or symbol-only titles)")
    }
    if ($Report.StatusEntries -gt 0) {
        [void]$parts.Add(("play status: {0} updated" -f $Report.Updated))
    }
    if ($Report.TotalsDeferred -gt 0) {
        [void]$parts.Add(("GOG/Epic play time deferred: {0} sessions still queued" -f $Report.TotalsDeferred))
    }
    else {
        foreach ($label in @("GOG", "Epic")) {
            if ($Report.Totals.ContainsKey($label)) {
                $t = $Report.Totals[$label]
                $hours = [Math]::Round($t.Minutes / 60, 1)
                [void]$parts.Add(("{0} play time: {1} imported ({2} h)" -f $label, $t.Imported, $hours))
            }
        }
    }
    if ($Report.SessionsSent -gt 0) {
        [void]$parts.Add("sessions sent: $($Report.SessionsSent)")
    }
    if ($Report.SessionsDropped -gt 0) {
        [void]$parts.Add("sessions dropped (no matching game): $($Report.SessionsDropped)")
    }
    if ($Report.Errors.Count -gt 0) {
        [void]$parts.Add("failed: " + ($Report.Errors -join "; "))
    }
    return ($parts -join "; ")
}

# -- Background execution -----------------------------------------------------

<#
    A fresh lock file means a background sync is running; a lock older than
    15 minutes is ignored so a crashed run cannot jam future syncs. The file
    carries a per-run token, so a slow first run never deletes a second run's
    lock when it finally finishes.
#>
function Test-QuestarrSyncLock {
    param([Parameter(Mandatory)] [string] $DataDir)

    $lock = Join-Path $DataDir "sync.lock"
    if (-not (Test-Path $lock)) { return $false }
    try {
        $content = [System.IO.File]::ReadAllText($lock)
        $parts = $content -split "\|", 2
        if ($parts.Count -lt 2) { return $false }
        $start = [DateTime]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture)
        return (([DateTime]::UtcNow - $start.ToUniversalTime()).TotalMinutes -lt 15)
    }
    catch {
        return $false
    }
}

function Remove-QuestarrSyncLock {
    param(
        [Parameter(Mandatory)] [string] $DataDir,
        [Parameter(Mandatory)] [string] $Token
    )

    try {
        $lockPath = Join-Path $DataDir "sync.lock"
        if (-not (Test-Path $lockPath)) { return }
        $current = [System.IO.File]::ReadAllText($lockPath)
        # Only the owner removes the lock: a long-running first sync must not
        # delete a lock that a later run has already replaced.
        if ($current.StartsWith($Token + "|")) {
            Remove-Item -LiteralPath $lockPath -Force
        }
    }
    catch { }
}

<#
    The background script. It runs in a bare runspace: no Playnite ambient
    variables, so everything it needs arrives as arguments, including the
    module path (as data, so an install path containing an apostrophe cannot
    break the generated script text).
#>
function Get-QuestarrBackgroundScript {
    return @"
param(`$Api, `$Logger, `$Config, `$DataDir, `$ModulePath, `$Token)
`$ErrorActionPreference = 'Continue'
try {
    Import-Module -Name `$ModulePath -DisableNameChecking
    `$work = New-QuestarrSyncWork -Api `$Api -Config `$Config -DataDir `$DataDir
    `$report = Invoke-QuestarrSyncCore -Work `$work
    `$summary = Get-QuestarrSyncSummary -Report `$report
    `$Logger.Info("Questarr: background sync done: " + `$summary)
    try {
        `$Api.Notifications.Remove('questarr-sync-running') | Out-Null
        `$msg = New-Object -TypeName Playnite.SDK.NotificationMessage -ArgumentList @('questarr-sync-done', ('Questarr sync: ' + `$summary), [Playnite.SDK.NotificationType]::Info)
        `$Api.Notifications.Add(`$msg)
    }
    catch {
        `$Logger.Error("Questarr: could not post the completion notification: " + `$_.Exception.Message)
    }
}
catch {
    try { `$Logger.Error("Questarr: background sync failed: " + `$_.Exception.Message) } catch { }
}
finally {
    try { Remove-QuestarrSyncLock -DataDir `$DataDir -Token `$Token } catch { }
}
"@
}

<#
    Fires the sync in a background runspace and returns immediately, so
    Playnite's UI never blocks. The completion summary arrives as a Playnite
    notification and in extensions.log.
#>
function Start-QuestarrBackgroundSync {
    param(
        [Parameter(Mandatory)] $Api,
        [Parameter(Mandatory)] $Logger,
        [Parameter(Mandatory)] $Config,
        [Parameter(Mandatory)] [string] $ModulePath,
        [Parameter(Mandatory)] [string] $DataDir
    )

    if (Test-QuestarrSyncLock -DataDir $DataDir) {
        $Logger.Info("Questarr: a background sync is already running, skipping this request")
        return
    }
    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    }
    $token = [Guid]::NewGuid().ToString()
    [System.IO.File]::WriteAllText((Join-Path $DataDir "sync.lock"), "$token|$([DateTime]::UtcNow.ToString('o'))")

    try {
        $Api.Notifications.Remove('questarr-sync-done') | Out-Null
        $running = New-Object -TypeName Playnite.SDK.NotificationMessage -ArgumentList @('questarr-sync-running', 'Questarr sync running in the background...', [Playnite.SDK.NotificationType]::Info)
        $Api.Notifications.Add($running)
    }
    catch {
        $Logger.Error("Questarr: could not post the running notification: " + $_.Exception.Message)
    }

    try {
        $script = Get-QuestarrBackgroundScript
        $ps = [System.Management.Automation.PowerShell]::Create()
        $null = $ps.AddScript($script)
        $null = $ps.AddArgument($Api)
        $null = $ps.AddArgument($Logger)
        $null = $ps.AddArgument($Config)
        $null = $ps.AddArgument($DataDir)
        $null = $ps.AddArgument($ModulePath)
        $null = $ps.AddArgument($Token)
        $null = $ps.BeginInvoke()
    }
    catch {
        # The reservation must not outlive a worker that never started.
        $Logger.Error("Questarr: could not launch the background sync: " + $_.Exception.Message)
        Remove-QuestarrSyncLock -DataDir $DataDir -Token $token
        try { $Api.Notifications.Remove('questarr-sync-running') | Out-Null } catch { }
    }
}

function Invoke-QuestarrLibrarySync {
    param($scriptMainMenuItemActionArgs)

    $config = Get-QuestarrConfigOrWarn
    if ($null -eq $config) { return }

    # Returns immediately; the work runs in a background runspace and the
    # summary arrives as a Playnite notification. Inline execution on this
    # thread blocks Playnite's UI for the whole sync and Windows marks the
    # app "Not Responding" after ~5 seconds, which is exactly the freeze
    # this avoids.
    #
    # The paths are resolved here, in the ambient runspace, and handed to the
    # background script: $PSScriptRoot is the module's own directory (next to
    # Playnite.exe in a portable install), and the data directory is wherever
    # this extension's data lives, so neither path is guessed from %APPDATA%.
    $modulePath = Join-Path $PSScriptRoot "Questarr.psm1"
    if (-not (Test-Path $modulePath)) {
        $modulePath = Join-Path $env:APPDATA "Playnite\Extensions\playnite-questarr\Questarr.psm1"
    }
    Start-QuestarrBackgroundSync -Api $PlayniteApi -Logger $__logger -Config $config -ModulePath $modulePath -DataDir $CurrentExtensionDataPath
}

# -- Request a game from the couch --------------------------------------------

function Invoke-QuestarrRequestGame {
    param($scriptGameMenuItemActionArgs)

    $config = Get-QuestarrConfigOrWarn
    if ($null -eq $config) { return }

    $added = New-Object System.Collections.ArrayList
    $already = New-Object System.Collections.ArrayList
    $failed = New-Object System.Collections.ArrayList

    foreach ($game in $scriptGameMenuItemActionArgs.Games) {
        if ([string]::IsNullOrWhiteSpace($game.Name)) { continue }

        try {
            $response = Invoke-QuestarrApi -Config $config -Path "/games/request" -Method "Post" `
                -Body @{ title = $game.Name }
            [void]$added.Add($response.game.title)
        }
        catch {
            $we = Get-QuestarrUnwrappedWebException $_
            $response = if ($we) { $we.Response } else { $null }
            if ($null -ne $response -and [int]$response.StatusCode -eq 409) {
                [void]$already.Add($game.Name)
            }
            else {
                [void]$failed.Add("$($game.Name): $(Get-QuestarrErrorMessage $_)")
            }
        }
    }

    $lines = New-Object System.Collections.ArrayList
    if ($added.Count -gt 0) {
        [void]$lines.Add("Requested on Questarr:`n  " + ($added -join "`n  "))
    }
    if ($already.Count -gt 0) {
        [void]$lines.Add("Already in your Questarr library:`n  " + ($already -join "`n  "))
    }
    if ($failed.Count -gt 0) {
        [void]$lines.Add("Failed:`n  " + ($failed -join "`n  "))
    }

    if ($lines.Count -eq 0) {
        $PlayniteApi.Dialogs.ShowMessage("No games with a usable title were selected.", "Questarr")
        return
    }

    $PlayniteApi.Dialogs.ShowMessage(($lines -join "`n`n"), "Questarr")
}

# -- Playnite lifecycle hooks -------------------------------------------------

<#
    Fired after Playnite finishes updating its library from the store plugins.
    The automatic sync is the same background push as the menu command, with
    the same overlap guard: the event handler itself does no heavy work, so
    the library refresh never stalls.
#>
function OnLibraryUpdated {
    param($eventArgs)

    $config = Get-QuestarrConfig
    if ($null -eq $config) { return }
    if (-not $config.SyncOnLibraryUpdate) { return }

    # Same path resolution as the menu command: the module's own directory and
    # this extension's data directory, both taken from the ambient runspace.
    $modulePath = Join-Path $PSScriptRoot "Questarr.psm1"
    if (-not (Test-Path $modulePath)) {
        $modulePath = Join-Path $env:APPDATA "Playnite\Extensions\playnite-questarr\Questarr.psm1"
    }
    Start-QuestarrBackgroundSync -Api $PlayniteApi -Logger $__logger -Config $config -ModulePath $modulePath -DataDir $CurrentExtensionDataPath
}

<#
    Playnite raises these around every launch. Only the start time needs
    remembering: Playnite itself reports how long the game ran when it stops.
#>
function OnGameStarted {
    param($eventArgs)

    $config = Get-QuestarrConfig
    if ($null -eq $config -or -not $config.TrackPlayTime) { return }

    $script:PlayStarts[$eventArgs.Game.Id.ToString()] = [DateTime]::UtcNow
}

function OnGameStopped {
    param($eventArgs)

    $config = Get-QuestarrConfig
    if ($null -eq $config -or -not $config.TrackPlayTime) { return }

    $game = $eventArgs.Game
    $key = $game.Id.ToString()
    $endedAt = [DateTime]::UtcNow

    $startedAt = $null
    if ($eventArgs.ElapsedSeconds -gt 0) {
        $startedAt = $endedAt.AddSeconds(-[double]$eventArgs.ElapsedSeconds)
    }
    elseif ($script:PlayStarts.ContainsKey($key)) {
        $startedAt = $script:PlayStarts[$key]
    }
    $script:PlayStarts.Remove($key)

    if ($null -ne $startedAt -and -not [string]::IsNullOrWhiteSpace($game.Name)) {
        # Quickly closed launches are noise, and the server caps a session at 24 hours.
        $seconds = ($endedAt - $startedAt).TotalSeconds
        if ($seconds -ge 60 -and $seconds -le 24 * 60 * 60) {
            $entry = [PSCustomObject]@{
                title      = $game.Name
                steamAppId = Get-QuestarrSteamAppId $game
                startedAt  = Format-QuestarrUtc $startedAt
                endedAt    = Format-QuestarrUtc $endedAt
            }
            # Queue first, then drain: a crash or a dead server never loses
            # the session. Both sides share the queue mutex, so a sync
            # running in the background cannot clobber this entry.
            try {
                $queued = Add-QuestarrQueuedSession -DataDir $CurrentExtensionDataPath -Entry $entry
                if (-not $queued) {
                    $__logger.Error("Questarr: could not take the queue lock to save the play session")
                    return
                }
            }
            catch {
                $__logger.Error("Questarr: could not queue the play session: $($_.Exception.Message)")
                return
            }
        }
    }

    try {
        Invoke-QuestarrQueueDrain -Config $config -DataDir $CurrentExtensionDataPath | Out-Null
    }
    catch {
        $__logger.Error("Questarr: play session upload failed: $($_.Exception.Message)")
    }
}

<#
    Playnite is the one place sessions are recorded while Questarr may be
    unreachable (a laptop away from home), so retry what is still waiting at
    startup.
#>
function OnApplicationStarted {
    param($eventArgs)

    $config = Get-QuestarrConfig
    if ($null -eq $config -or -not $config.TrackPlayTime) { return }

    try {
        Invoke-QuestarrQueueDrain -Config $config -DataDir $CurrentExtensionDataPath | Out-Null
    }
    catch {
        $__logger.Error("Questarr: play session upload failed: $($_.Exception.Message)")
    }
}
