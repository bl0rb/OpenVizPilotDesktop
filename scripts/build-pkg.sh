#!/bin/bash
# Wraps a built OpenVizPilot.app into an installer package for Intune ("macOS app (PKG)") and
# plain double-click installs: installs to /Applications and replaces an older copy with the
# same bundle ID.
#   APP                 path of the .app (default: the universal Tauri build)
#   VERSION             package version (default: version in src-tauri/tauri.conf.json)
#   OUT                 output file (default: dist/OpenVizPilot-<version>.pkg)
#   INSTALLER_IDENTITY  optional "Developer ID Installer: …" to sign the package
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${VERSION:-$(node -p "require('./src-tauri/tauri.conf.json').version")}"
APP="${APP:-src-tauri/target/universal-apple-darwin/release/bundle/macos/OpenVizPilot.app}"
OUT="${OUT:-dist/OpenVizPilot-$VERSION.pkg}"
[ -d "$APP" ] || { echo "No app bundle at $APP; run 'npx tauri build --bundles app' first." >&2; exit 1; }

ROOT="$(mktemp -d)"
mkdir -p "$ROOT/Applications" "$(dirname "$OUT")"
ditto --noextattr --noqtn "$APP" "$ROOT/Applications/OpenVizPilot.app"
COMPONENTS="$(mktemp -d)/components.plist"
pkgbuild --analyze --root "$ROOT" "$COMPONENTS" >/dev/null
# Always install to /Applications, even if another copy with the same bundle ID exists elsewhere.
plutil -replace 0.BundleIsRelocatable -bool NO "$COMPONENTS"

SIGN=()
[ -n "${INSTALLER_IDENTITY:-}" ] && SIGN=(--sign "$INSTALLER_IDENTITY" --timestamp)
pkgbuild --root "$ROOT" --component-plist "$COMPONENTS" --install-location / \
  --identifier de.werkworks.openvizpilot.desktop.pkg --version "${VERSION%%-*}" ${SIGN[@]+"${SIGN[@]}"} "$OUT"
echo "Built $OUT"
