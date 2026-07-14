#!/bin/sh
set -eu

docker compose up -d --build --remove-orphans
docker compose ps
