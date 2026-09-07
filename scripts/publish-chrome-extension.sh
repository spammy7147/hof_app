#!/usr/bin/env bash
set -Eeuo pipefail

artifact="$WORKSPACE/dist/$EXTENSION_ARTIFACT_NAME"
test -s "$artifact"
digest="$(sha256sum "$artifact" | awk '{print $1}')"
remote_temp="/tmp/${EXTENSION_ARTIFACT_NAME}.part-${BUILD_NUMBER}"
remote_final="$RELEASE_HOST_DIR/$EXTENSION_ARTIFACT_NAME"
remote_part="${remote_final}.part-${BUILD_NUMBER}"
link_part="$RELEASE_HOST_DIR/hof-chrome-extension-latest.zip.part-${BUILD_NUMBER}"
ssh_options=(-i "$SSH_KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes
    -o UserKnownHostsFile="$SSH_KNOWN_HOSTS_FILE" -o StrictHostKeyChecking=yes)
cleanup_remote() {
    ssh "${ssh_options[@]}" "$DEPLOY_TARGET" \
        "rm -f -- '$remote_temp' '$remote_part' '$link_part'" >/dev/null 2>&1 || true
}
trap cleanup_remote EXIT

scp "${ssh_options[@]}" "$artifact" "$DEPLOY_TARGET:$remote_temp"
ssh "${ssh_options[@]}" "$DEPLOY_TARGET" \
    "EXPECTED_SHA256='$digest' REMOTE_TEMP='$remote_temp' REMOTE_FINAL='$remote_final' REMOTE_PART='$remote_part' LINK_PART='$link_part' RELEASE_HOST_DIR='$RELEASE_HOST_DIR' ARTIFACT_NAME='$EXTENSION_ARTIFACT_NAME' bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail
install -d -m 750 "$RELEASE_HOST_DIR"
test "$(sha256sum "$REMOTE_TEMP" | awk '{print $1}')" = "$EXPECTED_SHA256"
if [ -e "$REMOTE_FINAL" ]; then
    test "$(sha256sum "$REMOTE_FINAL" | awk '{print $1}')" = "$EXPECTED_SHA256"
else
    install -m 640 "$REMOTE_TEMP" "$REMOTE_PART"
    mv "$REMOTE_PART" "$REMOTE_FINAL"
fi
ln -s "$ARTIFACT_NAME" "$LINK_PART"
mv -Tf "$LINK_PART" "$RELEASE_HOST_DIR/hof-chrome-extension-latest.zip"
REMOTE_SCRIPT

download_digest="$(curl --fail --silent --show-error --max-time 60 \
    "$EXTENSION_DOWNLOAD_URL" | sha256sum | awk '{print $1}')"
test "$download_digest" = "$digest"
printf 'Published Chrome extension: %s\nDownload: %s\n' "$EXTENSION_ARTIFACT_NAME" "$EXTENSION_DOWNLOAD_URL"
