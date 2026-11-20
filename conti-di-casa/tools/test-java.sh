#!/usr/bin/env bash
# Prova le funzioni Java senza Android (percorsi sicuri, testo JavaScript, nomi di file) con il solo JDK.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
javac -Xlint:-options -d "$OUT" android/src/app/contidicasa/Util.java android/test/UtilCheck.java
java -cp "$OUT" app.contidicasa.UtilCheck 2>&1 | grep -v '^Picked up'
