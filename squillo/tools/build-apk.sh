#!/usr/bin/env bash
# Costruisce l'APK di Squillo (Android) SENZA Gradle né Android Studio, solo con gli strumenti da riga di comando:
#   aapt2 (risorse), javac (+ dalvik-exchange per il DEX), zipalign e apksigner.
# Su Ubuntu/Debian:  sudo apt-get install -y aapt apksigner zipalign dalvik-exchange android-sdk-platform-23 default-jdk-headless
# Uso:  npm run build && bash tools/build-apk.sh        → release/Squillo-<versione>-Android.apk
#
# La firma è quella di PROVA (android/debug.keystore, password «android»): va bene per installare «da fonti sconosciute»,
# non per Google Play. Gli aggiornamenti si installano sopra solo se firmati con la stessa chiave.
set -euo pipefail
cd "$(dirname "$0")/.."

ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
VERSION="$(node -p "require('./package.json').version")"
CODE="$(node -p "const [a,b,c]=require('./package.json').version.split('.').map(Number); a*10000+b*100+c")"
OUT=release/Squillo-${VERSION}-Android.apk
B=build/android
[ -f "$ANDROID_JAR" ] || { echo "Manca android.jar ($ANDROID_JAR). Installa android-sdk-platform-23."; exit 1; }
[ -f dist/index.html ] || { echo "Manca dist/: esegui prima «npm run build»."; exit 1; }

rm -rf "$B" && mkdir -p "$B/compiled" "$B/classes" "$B/assets/squillo" release
# solo ciò che serve all'app (niente service worker: nell'app non serve)
cp -r dist/. "$B/assets/squillo/" && rm -f "$B/assets/squillo/sw.js"

aapt2 compile --dir android/res -o "$B/compiled/res.zip"
aapt2 link -o "$B/base.apk" -I "$ANDROID_JAR" --manifest android/AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 30 --version-code "$CODE" --version-name "$VERSION" \
  -A "$B/assets" "$B/compiled/res.zip"

javac --release 8 -Xlint:-options -cp "$ANDROID_JAR" -d "$B/classes" $(find android/src -name '*.java')
dalvik-exchange --dex --min-sdk-version=24 --output="$B/classes.dex" "$B/classes"
( cd "$B" && zip -q -j base.apk classes.dex )

zipalign -f -p 4 "$B/base.apk" "$B/aligned.apk"
apksigner sign --ks android/debug.keystore --ks-pass pass:android --key-pass pass:android --ks-key-alias squillo \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out "$OUT" "$B/aligned.apk"
apksigner verify --verbose "$OUT" | head -4
echo "→ $OUT ($(du -h "$OUT" | cut -f1))"
