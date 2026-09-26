#!/usr/bin/env bash
# User-operated test install only. Never stops/restarts DSH or any GPU process.
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---check}"
[[ "$mode" == --check || "$mode" == --apply ]] || { echo 'Usage: bash install-local-test.sh [--check|--apply]' >&2; exit 2; }
artifact="$root/artifacts/dsh-btw-0.4.0-smart.4.tgz"
[[ -f "$artifact" ]] || { echo 'Build and pack the test artifact first.' >&2; exit 1; }
(cd "$root/artifacts" && sha256sum -c SHA256SUMS)
version="$(dsh --version)"
[[ "$version" =~ (^|[[:space:]])0\.1\.5-rc\.2($|[[:space:]]) ]] || { echo 'Only DSH 0.1.5-rc.2 was tested. No changes made.' >&2; exit 1; }
if [[ "$mode" == --check ]]; then
  echo 'Candidate verified. No files or running services changed.'
  echo 'When all DSH turns are idle: stop dsh-web.service yourself, then rerun with --apply.'
  exit 0
fi
if systemctl --user is-active --quiet dsh-web.service; then
  echo 'Refusing installation while dsh-web.service is active. Wait for all turns to finish, then stop it yourself.' >&2
  exit 1
fi
home="${DSH_HOME:-$HOME/.dsh}"
profile="$home/profiles/web"
[[ -f "$profile/package.json" ]] || { echo 'Existing web profile required.' >&2; exit 1; }
mkdir -p "$home/backups"
backup="$(mktemp -d "$home/backups/btw-preview-XXXXXXXX")"
for name in package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.yml cordis.patch.yml; do
  if [[ -f "$profile/$name" ]]; then cp -p -- "$profile/$name" "$backup/$name"; fi
done
printf 'Profile metadata backup: %s\n' "$backup"
# This replaces the package dependency, not the old source directory or audit data.
# Keep the archive in place while the profile dependency references it.
dsh plugin --profile web add -w "$artifact" --ignore-scripts --config.auto-install-peers=false
echo 'Installed candidate. Services remain stopped; review output before starting.'
echo 'Start when ready: systemctl --user start dsh-web.service'
echo 'Then reload all DSH tabs. Do not start/stop GPU workloads for this test.'
