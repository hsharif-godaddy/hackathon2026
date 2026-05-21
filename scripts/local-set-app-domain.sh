#!/usr/bin/env bash
# Attach a custom sender domain to a local-dev app's alloc config so the
# email gateway will accept it as a verified `from`. Edits the live
# /tmp/airo-app-builder/{appId}/local/{preview,publish}/config.json files
# (the post-MigrateTaskConfig location — see
# dev-supervisor/internal/allocconfig/migrate.go).
#
# Idempotent: if the domain is already attached, the script is a no-op.
# The dev-supervisor loader has a 5-second cache TTL, so changes are
# picked up by the next email send within ~5 seconds. No container
# restart needed.
#
# Usage:
#   ./scripts/local-set-app-domain.sh <appId> <domain> [--primary]
#
# Examples:
#   ./scripts/local-set-app-domain.sh kcuoooe7yx acme.com
#   ./scripts/local-set-app-domain.sh kcuoooe7yx shop.acme.com --primary

set -euo pipefail

APPS_BASE_DIR="${APPS_BASE_DIR:-/tmp/airo-app-builder}"

usage() {
	cat >&2 <<EOF
Usage: $0 <appId> <domain> [--primary]

  appId      The 10-char app identifier (lowercase alphanumeric).
  domain     The FQDN to attach (e.g. acme.com, shop.acme.com).
  --primary  Make this the primary sender domain (demotes existing primary).

Edits /tmp/airo-app-builder/<appId>/local/{preview,publish}/config.json.
Picked up automatically within ~5 seconds (loader cache TTL).
EOF
	exit 2
}

die() {
	echo "error: $*" >&2
	exit 1
}

# --- Arg parsing -------------------------------------------------------------

PRIMARY=0
POSITIONAL=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--primary) PRIMARY=1; shift ;;
		-h|--help) usage ;;
		--*) die "unknown flag: $1" ;;
		*) POSITIONAL+=("$1"); shift ;;
	esac
done

if [[ ${#POSITIONAL[@]} -ne 2 ]]; then
	usage
fi

APP_ID="${POSITIONAL[0]}"
DOMAIN="${POSITIONAL[1]}"

# --- Validation --------------------------------------------------------------

if ! [[ "$APP_ID" =~ ^[a-z0-9]{10}$ ]]; then
	die "appId must be 10 lowercase alphanumeric characters (got: '$APP_ID')"
fi

if [[ -z "$DOMAIN" ]] || [[ "$DOMAIN" =~ [[:space:]@] ]] || [[ "$DOMAIN" != *.* ]]; then
	die "domain must be a non-empty FQDN with no whitespace or '@' (got: '$DOMAIN')"
fi

if ! command -v jq >/dev/null 2>&1; then
	die "jq is required but not installed (brew install jq)"
fi

APP_DIR="$APPS_BASE_DIR/$APP_ID"
if [[ ! -d "$APP_DIR" ]]; then
	die "app directory not found: $APP_DIR (is the app set up?)"
fi

# --- Edit each variant's config.json ----------------------------------------

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TARGETS=(
	"$APP_DIR/local/preview/config.json"
	"$APP_DIR/local/publish/config.json"
)

# Decide what to do based on the state of the first existing target.
# All targets share the same DOMAINS shape (writeConfigFiles writes them
# identically), so one read is enough to pick the action — and using the
# same action for both files keeps them consistent.
PROBE=""
for FILE in "${TARGETS[@]}"; do
	if [[ -f "$FILE" ]]; then PROBE="$FILE"; break; fi
done
if [[ -z "$PROBE" ]]; then
	die "no config files found under $APP_DIR/local/{preview,publish}/"
fi

HAS_DOMAIN="$(jq --arg d "$DOMAIN" '(.DOMAINS.VALUE // []) | map(.fqdn == $d) | any' "$PROBE")"
IS_PRIMARY_ALREADY="$(jq --arg d "$DOMAIN" '(.DOMAINS.VALUE // []) | map(select(.fqdn == $d) | .isPrimary) | any' "$PROBE")"

# ACTION: one of "append", "promote", "noop".
#   append  — domain not in list; will be added (primary if --primary or list empty)
#   promote — domain in list but not primary, --primary passed; flip the primary
#   noop    — domain already in list with the desired primary state
if [[ "$HAS_DOMAIN" == "false" ]]; then
	ACTION="append"
elif [[ $PRIMARY -eq 1 && "$IS_PRIMARY_ALREADY" == "false" ]]; then
	ACTION="promote"
else
	ACTION="noop"
fi

if [[ "$ACTION" != "noop" ]]; then
	for FILE in "${TARGETS[@]}"; do
		if [[ ! -f "$FILE" ]]; then
			echo "warn: skipping $FILE (file not found)" >&2
			continue
		fi

		UPDATED="$(
			jq \
				--arg domain "$DOMAIN" \
				--arg now "$NOW" \
				--arg action "$ACTION" \
				--argjson primary "$PRIMARY" \
				'
				def existing: (.DOMAINS.VALUE // []);
				def is_first: (existing | length) == 0;
				def new_entry:
					{
						fqdn: $domain,
						domainType: "fqdn",
						prefix: null,
						isPrimary: ($primary == 1 or is_first),
						status: "active",
						createdAt: $now,
						updatedAt: $now
					};
				if $action == "append" then
					.DOMAINS = {
						SYSTEM_MANAGED: true,
						VALUE: (
							(existing | if $primary == 1 then map(.isPrimary = false) else . end)
							+ [new_entry]
						)
					}
				elif $action == "promote" then
					.DOMAINS.VALUE = (
						existing | map(
							if .fqdn == $domain
								then .isPrimary = true | .updatedAt = $now
								else .isPrimary = false
							end
						)
					)
				else
					.
				end
				' \
				"$FILE"
		)"

		# Atomic write so an interrupted edit doesn't leave a partial file
		# (the loader would refuse to parse it and fail closed).
		#
		# Capture the original mode before the rename — `mv` replaces both
		# content AND permissions with the temp's umask-default, which is
		# typically 0644 (less restrictive than the 0600 written by
		# template.go). Restoring the captured mode preserves whatever
		# local-control-plane chose, regardless of host umask. Forcing a
		# fixed `chmod 600` here would lock dev-supervisor out of the
		# config if it runs as a different uid than the script invoker
		# (the loader fails closed → email sends silently start failing).
		# stat flags differ between BSD (macOS) and GNU (Linux); the chain
		# tries BSD first and falls back to GNU.
		ORIG_MODE="$(stat -f '%Lp' "$FILE" 2>/dev/null || stat -c '%a' "$FILE" 2>/dev/null || true)"
		TMP="$FILE.tmp.$$"
		printf '%s\n' "$UPDATED" >"$TMP"
		mv "$TMP" "$FILE"
		if [[ -n "$ORIG_MODE" ]]; then
			chmod "$ORIG_MODE" "$FILE"
		fi
	done
fi

# --- Report ------------------------------------------------------------------

case "$ACTION" in
	append)
		echo "✓ attached '$DOMAIN' to $APP_ID"
		if [[ $PRIMARY -eq 1 ]]; then
			echo "  marked as primary (demoted any existing primary)"
		fi
		;;
	promote)
		echo "✓ promoted '$DOMAIN' to primary for $APP_ID (demoted any existing primary)"
		;;
	noop)
		if [[ "$IS_PRIMARY_ALREADY" == "true" ]]; then
			echo "= '$DOMAIN' already attached to $APP_ID as primary (no change)"
		else
			echo "= '$DOMAIN' already attached to $APP_ID (no change; pass --primary to promote)"
		fi
		;;
esac

# Show resulting list from the preview file (both files were updated identically)
PREVIEW_FILE="$APP_DIR/local/preview/config.json"
if [[ -f "$PREVIEW_FILE" ]]; then
	echo
	echo "Verified domains for $APP_ID:"
	jq -r '
		(.DOMAINS.VALUE // [])
		| sort_by(.isPrimary | not)
		| .[]
		| "  - \(.fqdn)\(if .isPrimary then "  [primary]" else "" end)  (\(.status))"
	' "$PREVIEW_FILE"
fi

# Test snippet — gateway is loopback-only inside the container, so we
# need docker exec. Container name follows local-control-plane's
# preview-{appId}-1 naming convention.
cat <<EOF

Test the gateway (wait ~5s for the loader cache to expire):

  docker exec preview-${APP_ID}-1 curl -s -X POST http://127.0.0.1:2525/api/email/send \\
    -H 'content-type: application/json' \\
    -d '{"to":["test@example.com"],"from":"hello@${DOMAIN}","subject":"test","text":"hi"}'

Expect: {"success":true,"messageId":"…"}
EOF
