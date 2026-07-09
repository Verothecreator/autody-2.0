#!/bin/bash

set -e

APP_DIR="${AUTODY_APP_DIR:-/var/www/autody-2.0}"
APP_NAME="${AUTODY_PM2_APP:-autody}"

cd "$APP_DIR"

echo "Deploy script started"

git fetch origin main
git pull --ff-only origin main
npm install --omit=dev --no-package-lock
pm2 restart "$APP_NAME" --update-env
pm2 save

echo "Deploy finished"
