#!/usr/bin/env bash
# Copy another athlete's Strava activity onto your account, heart rate included
# — for the days you wore someone else's watch.
#
# Runs on the VPS, where the database holds every athlete's Strava tokens
# (a refresh rotates them, and the rotation must land in the live database).
#
# Usage: deploy/import-activity.sh --activity <id> [--from <athleteId>]
#                                 [--to <athleteId>] [--name "..."]
#                                 [--description "..."] [--dry-run]
#
# The script must be deployed first (deploy/deploy.sh ships it with the server).
set -euo pipefail

HOST=${STRAVABOARD_HOST:-crovps}
APP_DIR=/home/ubuntu/stravaboard

if [ $# -eq 0 ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

# shellcheck disable=SC2029  # the arguments are meant to expand locally
ssh "$HOST" "cd $APP_DIR && /usr/local/bin/node22 server/scripts/importActivity.js $(printf '%q ' "$@")"
