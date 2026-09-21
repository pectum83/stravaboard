#!/usr/bin/env bash
# Splice two consecutive Strava activities into one, inventing the stretch the
# watch never recorded — for the days the recording stopped mid-outing.
#
# Runs on the VPS, where the database holds every athlete's Strava tokens
# (a refresh rotates them, and the rotation must land in the live database).
#
# Usage: deploy/merge-activities.sh --first <id> --second <id> [--pause <s>]
#                                   [--speed <m/s>] [--name "..."] [--tag v2]
#                                   [--dry-run] [--from-snapshot <file>]
#
# A dry run writes the TCX, a GeoJSON of the fabricated stretch and a snapshot
# of both activities, then copies all three back into ./merge-artifacts/ —
# the snapshot is the only copy that keeps heart rate and cadence once the
# originals are deleted from Strava.
#
# The script must be deployed first (deploy/deploy.sh ships it with the server).
set -euo pipefail

HOST=${STRAVABOARD_HOST:-crovps}
APP_DIR=/home/ubuntu/stravaboard
ARTIFACTS=merge-artifacts

if [ $# -eq 0 ]; then
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

# Fixed remote paths, so the artifacts always land somewhere we know to fetch.
REMOTE_TCX=/tmp/stravaboard-merge.tcx
REMOTE_GEOJSON=/tmp/stravaboard-merge.geojson
REMOTE_SNAPSHOT=/tmp/stravaboard-merge.sources.json

args=("$@")
dry_run=0
for arg in "$@"; do
  [ "$arg" = "--dry-run" ] && dry_run=1
done
if [ "$dry_run" = 1 ]; then
  args+=(--out "$REMOTE_TCX" --geojson "$REMOTE_GEOJSON" --snapshot "$REMOTE_SNAPSHOT")
fi

# shellcheck disable=SC2029  # the arguments are meant to expand locally
ssh "$HOST" "cd $APP_DIR && /usr/local/bin/node22 server/scripts/mergeActivities.js $(printf '%q ' "${args[@]}")"

if [ "$dry_run" = 1 ]; then
  mkdir -p "$ARTIFACTS"
  scp "$HOST:$REMOTE_TCX" "$HOST:$REMOTE_GEOJSON" "$HOST:$REMOTE_SNAPSHOT" "$ARTIFACTS/"
  echo "artifacts in $ARTIFACTS/ — audit the TCX and open the GeoJSON on a map"
fi
