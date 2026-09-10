Questarr Windows Installer
==========================

The installer requires administrator rights. It installs Questarr to Program
Files, creates a Windows service named Questarr, starts it automatically, and
adds an inbound Windows Firewall rule for the bundled Questarr Node runtime.
During upgrades, setup stops the existing Questarr service and any remaining
Questarr processes running from the install directory before replacing files.

After installation, open http://localhost:5000 in your browser.

Runtime data is stored in C:\ProgramData\Questarr (the install directory's
"data" folder is an NTFS junction into this location, so Questarr's own
config lookup finds it there automatically - the same way the Docker image
bind-mounts a "data" folder):

- data\sqlite.db: SQLite database
- data\config.yaml: app configuration (e.g. SSL settings)
- logs\questarr.log: service process output
- config.env: optional service environment overrides, such as PORT=5001

Uninstalling removes the Windows service, the firewall rule, and the
install-directory data junction. Runtime data in C:\ProgramData\Questarr
itself is preserved so accidental uninstalls (or a clean reinstall) do not
delete the database or configuration.

No in-app auto-updater
-----------------------
This installer does not include an in-app update checker or self-updater.
To upgrade, download the newer QuestarrSetup-*.exe and run it - the installer
detects the existing install, stops the service, replaces changed files, and
restarts it, preserving your ProgramData. There is currently no "Check for
updates" button inside Questarr itself; watch the GitHub Releases page
(https://github.com/Doezer/Questarr/releases) or the repository for new
versions.

Building the installer
-----------------------
The installer is built by the "windows-installer" job in
.github/workflows/deploy.yml. It is opt-in and does not run by default: to
build it, trigger the "Deploy Web App" workflow manually (workflow_dispatch)
with the "build_windows_installer" input set to true. The finished
QuestarrSetup-<version>-windows-x64.exe and its matching .sha256 checksum
file are uploaded as a workflow artifact; if a release tag was supplied and
a matching GitHub Release already exists, they are also attached to that
release.
