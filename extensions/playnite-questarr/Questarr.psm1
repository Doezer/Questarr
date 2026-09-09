<#
    Questarr integration for Playnite.

    Connects a Playnite install to a self-hosted Questarr server so the couch PC
    can push its library up and request games back down without touching the
    browser UI.

    Talks only to Questarr's /api/integration surface, authenticating with an
    integration API key minted in Settings -> Integrations.
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

$script:ConfigFileName = "config.json"

# Playnite caps a single sync at a few thousand games; batch well under the
# server's own limit so large libraries stay within one request each time.
$script:SyncBatchSize = 500

function Get-QuestarrConfigPath {
    return (Join-Path $CurrentExtensionDataPath $script:ConfigFileName)
}

<#
    The API key is stored with DPAPI (ConvertFrom-SecureString), which encrypts
    it against the current Windows user account. That keeps the key unreadable
    to other users on the machine and to anything that merely copies the file
    off it. It is not protection against code running as this same user.
#>
function Save-QuestarrConfig {
    param(
        [Parameter(Mandatory)] [string] $ServerUrl,
        [Parameter(Mandatory)] [string] $ApiKey,
        [bool] $SyncOnLibraryUpdate = $false,
        [bool] $MarkInstalledAsOwned = $false
    )

    if (-not (Test-Path $CurrentExtensionDataPath)) {
        New-Item -ItemType Directory -Path $CurrentExtensionDataPath -Force | Out-Null
    }

    $secured = ConvertTo-SecureString -String $ApiKey -AsPlainText -Force |
        ConvertFrom-SecureString

    $config = [PSCustomObject]@{
        ServerUrl            = $ServerUrl.TrimEnd("/")
        ApiKeyEncrypted      = $secured
        SyncOnLibraryUpdate  = $SyncOnLibraryUpdate
        MarkInstalledAsOwned = $MarkInstalledAsOwned
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
        ServerUrl            = $raw.ServerUrl
        ApiKey               = $apiKey
        SyncOnLibraryUpdate  = [bool]$raw.SyncOnLibraryUpdate
        MarkInstalledAsOwned = [bool]$raw.MarkInstalledAsOwned
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
    fails exactly the way a refused redirect always has.

    The body is encoded to UTF-8 bytes by hand because Invoke-RestMethod on
    PowerShell 5.1 otherwise sends JSON as ISO-8859-1, which mangles any
    non-ASCII game title (Pokémon, Ōkami, Nier Replicant ...) on the way up --
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
                    $redirectUri = [Uri]::new([Uri]$Uri, $location)
                    if ($redirectUri.Host -ieq ([Uri]$Uri).Host) {
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
    Turns an exception from Invoke-QuestarrHttpRequest into something a user
    can act on. The status code matters here: 401 means the key is wrong,
    which is a very different fix from "the server is unreachable". A 3xx
    means Invoke-QuestarrHttpRequest found a redirect it refused to follow
    (anywhere but the exact same host) -- the API key never got sent there.
#>
function Get-QuestarrErrorMessage {
    param([Parameter(Mandatory)] $ErrorRecord)

    $response = $ErrorRecord.Exception.Response
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

# ── Menu wiring ──────────────────────────────────────────────────────────────

function GetMainMenuItems {
    param($getMainMenuItemsArgs)

    $items = @()

    $connect = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $connect.Description = "Connect to Questarr..."
    $connect.FunctionName = "Invoke-QuestarrConnect"
    $connect.MenuSection = "@Questarr"
    $items += $connect

    $sync = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $sync.Description = "Sync library to Questarr"
    $sync.FunctionName = "Invoke-QuestarrLibrarySync"
    $sync.MenuSection = "@Questarr"
    $items += $sync

    $toggle = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $toggle.Description = "Toggle automatic sync on library update"
    $toggle.FunctionName = "Invoke-QuestarrToggleAutoSync"
    $toggle.MenuSection = "@Questarr"
    $items += $toggle

    $owned = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $owned.Description = "Toggle promoting installed games to owned"
    $owned.FunctionName = "Invoke-QuestarrToggleMarkInstalledAsOwned"
    $owned.MenuSection = "@Questarr"
    $items += $owned

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

# ── Actions ──────────────────────────────────────────────────────────────────

<#
    Whether $HostName names a machine on the caller's own local network rather
    than somewhere out on the internet: loopback, an RFC1918/link-local IP
    literal, or a hostname with no dot / an mDNS ".local" suffix (the two
    conventions actual home-network devices use -- "questarr", "nas",
    "questarr.local").

    A plain-HTTP address always gets a warn-and-continue choice rather than
    being refused outright -- this only decides how alarming that warning's
    wording is ("your own network" vs. "outside your network, on the open
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
        "Questarr API key (Settings -> Integrations -> Playnite):", "Questarr", "")
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

    # Only persist a credential that has actually been proven to work.
    Save-QuestarrConfig `
        -ServerUrl $serverUrl `
        -ApiKey $apiKey `
        -SyncOnLibraryUpdate $(if ($existing) { $existing.SyncOnLibraryUpdate } else { $false }) `
        -MarkInstalledAsOwned $(if ($existing) { $existing.MarkInstalledAsOwned } else { $false })

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
        -MarkInstalledAsOwned $config.MarkInstalledAsOwned

    $state = if ($enabled) { "enabled" } else { "disabled" }
    $PlayniteApi.Dialogs.ShowMessage("Automatic sync on library update is now $state.", "Questarr")
}

function Invoke-QuestarrToggleMarkInstalledAsOwned {
    param($scriptMainMenuItemActionArgs)

    $config = Get-QuestarrConfigOrWarn
    if ($null -eq $config) { return }

    $enabled = -not $config.MarkInstalledAsOwned
    Save-QuestarrConfig `
        -ServerUrl $config.ServerUrl `
        -ApiKey $config.ApiKey `
        -SyncOnLibraryUpdate $config.SyncOnLibraryUpdate `
        -MarkInstalledAsOwned $enabled

    $state = if ($enabled) { "enabled" } else { "disabled" }
    $PlayniteApi.Dialogs.ShowMessage(
        "Promoting an installed 'wanted' game to 'owned' during sync is now $state.", "Questarr")
}

<#
    Maps the Playnite database onto the payload Questarr's sync endpoint expects.
    Only games with a real name are sent; Playnite allows blank names and the
    server rejects them.
#>
function Get-QuestarrSyncPayload {
    $entries = New-Object System.Collections.ArrayList

    foreach ($game in $PlayniteApi.Database.Games) {
        if ([string]::IsNullOrWhiteSpace($game.Name)) { continue }

        $entry = @{
            title      = $game.Name
            externalId = $game.Id.ToString()
            installed  = [bool]$game.IsInstalled
        }

        # Steam is the one Playnite library whose GameId maps cleanly onto an
        # identifier Questarr also stores, so it gets an exact match instead of
        # a title comparison.
        if ($game.PluginId -eq [Guid]"cb91dfc9-b977-43bf-8e70-55f46e410fab") {
            $steamAppId = 0
            if ([int]::TryParse($game.GameId, [ref]$steamAppId) -and $steamAppId -gt 0) {
                $entry.steamAppId = $steamAppId
            }
        }

        [void]$entries.Add($entry)
    }

    # Comma operator: returning the ArrayList bare would let PowerShell unroll it
    # into the pipeline and hand the caller a plain Object[] without GetRange().
    return , $entries
}

function Invoke-QuestarrLibrarySync {
    param($scriptMainMenuItemActionArgs)

    $config = Get-QuestarrConfigOrWarn
    if ($null -eq $config) { return }

    $entries = Get-QuestarrSyncPayload
    if ($entries.Count -eq 0) {
        $PlayniteApi.Dialogs.ShowMessage("There are no games in this Playnite library to sync.", "Questarr")
        return
    }

    $result = Invoke-QuestarrSyncWithProgress -Config $config -Entries $entries
    if ($null -eq $result) { return }

    $PlayniteApi.Dialogs.ShowMessage(
        ("Synced {0} games to Questarr.`n`nMatched: {1}`nNot in Questarr: {2}`nPromoted to owned: {3}" -f `
            $entries.Count, $result.Matched, $result.Unmatched, $result.Promoted),
        "Questarr")
}

<#
    Sends the library in batches and folds the per-batch responses into one
    tally. Throws on the first batch that fails, so the caller reports a single
    clear reason rather than a partial success that looks complete.
#>
function Invoke-QuestarrSyncBatches {
    param(
        [Parameter(Mandatory)] $Config,
        [Parameter(Mandatory)] $Entries,
        $Progress = $null
    )

    $matched = 0
    $unmatched = 0
    $promoted = 0

    for ($offset = 0; $offset -lt $Entries.Count; $offset += $script:SyncBatchSize) {
        if ($null -ne $Progress -and $Progress.CancelToken.IsCancellationRequested) {
            # $null here (not a partial tally) is what tells the caller this
            # was cancelled, not completed -- Invoke-QuestarrSyncWithProgress
            # and Invoke-QuestarrLibrarySync already treat $null as "say
            # nothing, don't show a completed-sync dialog for a run the user
            # cut short".
            return $null
        }

        $take = [Math]::Min($script:SyncBatchSize, $Entries.Count - $offset)
        $batch = @($Entries.GetRange($offset, $take))

        $response = Invoke-QuestarrApi -Config $Config -Path "/library/sync" -Method "Post" -Body @{
            games                = $batch
            markInstalledAsOwned = $Config.MarkInstalledAsOwned
        }

        $matched += @($response.matched).Count
        $unmatched += @($response.unmatched).Count
        $promoted += [int]$response.promotedToOwned

        if ($null -ne $Progress) {
            $Progress.CurrentProgressValue = $offset + $take
        }
    }

    return [PSCustomObject]@{
        Matched   = $matched
        Unmatched = $unmatched
        Promoted  = $promoted
    }
}

<#
    Runs a sync behind Playnite's progress dialog.

    The dialog invokes its scriptblock on another thread, so results travel back
    through script-scoped variables rather than by mutating locals the closure
    happens to see.
#>
function Invoke-QuestarrSyncWithProgress {
    param(
        [Parameter(Mandatory)] $Config,
        [Parameter(Mandatory)] $Entries
    )

    $script:SyncConfig = $Config
    $script:SyncEntries = $Entries
    $script:SyncResult = $null
    $script:SyncError = $null

    $options = New-Object Playnite.SDK.GlobalProgressOptions("Syncing library to Questarr...", $true)
    $options.IsIndeterminate = $false

    $PlayniteApi.Dialogs.ActivateGlobalProgress({
            param($progress)
            $progress.ProgressMaxValue = $script:SyncEntries.Count
            try {
                $script:SyncResult = Invoke-QuestarrSyncBatches `
                    -Config $script:SyncConfig -Entries $script:SyncEntries -Progress $progress
            }
            catch {
                $script:SyncError = Get-QuestarrErrorMessage $_
            }
        }, $options) | Out-Null

    if ($null -ne $script:SyncError) {
        $__logger.Error("Questarr: library sync failed: $($script:SyncError)")
        $PlayniteApi.Dialogs.ShowErrorMessage($script:SyncError, "Questarr")
        return $null
    }

    return $script:SyncResult
}

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
            $response = $_.Exception.Response
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

# ── Playnite lifecycle hooks ─────────────────────────────────────────────────

<#
    Fired after Playnite finishes updating its library from the store plugins.
    Syncing here is what makes the integration feel automatic: a game installed
    on the couch PC shows up in Questarr without anyone opening a browser.
#>
function OnLibraryUpdated {
    param($eventArgs)

    $config = Get-QuestarrConfig
    if ($null -eq $config -or -not $config.SyncOnLibraryUpdate) { return }

    $entries = Get-QuestarrSyncPayload
    if ($entries.Count -eq 0) { return }

    try {
        $result = Invoke-QuestarrSyncBatches -Config $config -Entries $entries
    }
    catch {
        # A background sync must never interrupt Playnite with a dialog.
        $__logger.Error("Questarr: auto-sync failed: $(Get-QuestarrErrorMessage $_)")
        return
    }

    $__logger.Info(
        "Questarr: auto-sync matched $($result.Matched), unmatched $($result.Unmatched), promoted $($result.Promoted)")
}
