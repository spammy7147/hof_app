pipeline {
    agent {
        label 'spammy-builder'
    }

    tools {
        nodejs 'nodejs-22'
    }

    options {
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timestamps()
        timeout(time: 60, unit: 'MINUTES')
    }

    environment {
        ANDROID_KEYSTORE_CREDENTIAL_ID = 'hof-spammy-app-secretkey'
        ANDROID_KEYSTORE_PASSWORD_CREDENTIAL_ID = 'hof-spammy-app-secretkey-password'
        GOOGLE_SERVICES_CREDENTIAL_ID = 'hof-spammy-app-google-services'
        SSH_CREDENTIAL_ID = 'hof-deploy-ssh'
        PUBLISH_TOKEN_CREDENTIAL_ID = 'hof-spammy-publish-token'
        ANDROID_KEY_ALIAS = 'app.spammy.hof'
        EXPECTED_SIGNING_CERT_SHA256 = 'adac7cdc743c991d5d8517c8766ffb1af7c00d58232b6c1c947d0fd7072b4f7d'
        DEPLOY_TARGET = 'spammy@192.168.50.202'
        DEPLOY_HOST_IP = '192.168.50.202'
        SSH_KNOWN_HOSTS_FILE = "${WORKSPACE}/.jenkins/known_hosts"
        RELEASE_HOST_DIR = '/home/spammy/hof/releases'
        BACKEND_RELEASE_PUBLISH_URL = 'http://192.168.50.202:8080/internal/app-releases/android'
        EXTENSION_DOWNLOAD_URL = 'https://api-hof.spammy.app/extension/lastest'
        NPM_CONFIG_CACHE = '/home/jenkins/workspace/.npm-cache'
        GRADLE_USER_HOME = '/home/jenkins/workspace/.gradle-cache/hof-app'
        HOF_CI_STATE_DIR = "${WORKSPACE}/.jenkins-state"
        CI = 'true'
    }

    stages {
        stage('Checkout') {
            steps {
                sh '''#!/usr/bin/env bash
                    set -Eeuo pipefail
                    if git -C "$WORKSPACE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
                        # Preserve ignored dependency and native build outputs. Git
                        # still removes stale untracked, non-ignored files.
                        git -C "$WORKSPACE" clean -ffd
                    fi
                '''
                checkout scm
                // node_modules, generated Android sources, CMake objects, and Gradle
                // project state are ignored by Git and intentionally survive builds.
                sh 'git clean -ffd'
                script {
                    env.GIT_REVISION = sh(
                        script: 'git rev-parse HEAD',
                        returnStdout: true,
                    ).trim()
                    env.GIT_SHORT = sh(
                        script: 'git rev-parse --short=12 HEAD',
                        returnStdout: true,
                    ).trim()
                }
            }
        }

        stage('Preflight') {
            steps {
                sh '''#!/usr/bin/env bash
                    set -Eeuo pipefail

                    command -v node
                    command -v python3
                    command -v npm
                    command -v java
                    command -v keytool
                    command -v sha256sum
                    command -v install
                    command -v ssh
                    command -v scp
                    command -v ssh-keygen
                    command -v curl

                    node - <<'NODE'
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  throw new Error(`Expo SDK 57 requires Node.js 22.13 or newer; found ${process.versions.node}`);
}
NODE

                    java_major="$(java -version 2>&1 | awk -F'[".]' '/version/ { print $2; exit }')"
                    if [ "$java_major" != '21' ]; then
                        echo "HOF Android release builds require Java 21; found Java ${java_major:-unknown}." >&2
                        exit 1
                    fi

                    android_home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
                    if [ -z "$android_home" ] || [ ! -d "$android_home" ]; then
                        echo 'ANDROID_HOME or ANDROID_SDK_ROOT must point to an installed Android SDK.' >&2
                        exit 1
                    fi
                    test -d "$android_home/build-tools"
                    test -r "$SSH_KNOWN_HOSTS_FILE"
                    ssh-keygen -F "$DEPLOY_HOST_IP" -f "$SSH_KNOWN_HOSTS_FILE" >/dev/null

                '''
                withCredentials([
                    sshUserPrivateKey(
                        credentialsId: "${SSH_CREDENTIAL_ID}",
                        keyFileVariable: 'SSH_KEY_FILE',
                    ),
                ]) {
                    sh '''#!/usr/bin/env bash
                        set -Eeuo pipefail
                        ssh -i "$SSH_KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes \
                          -o UserKnownHostsFile="$SSH_KNOWN_HOSTS_FILE" -o StrictHostKeyChecking=yes \
                          "$DEPLOY_TARGET" \
                          'command -v bash >/dev/null && command -v sha256sum >/dev/null && command -v install >/dev/null'
                    '''
                }
            }
        }

        stage('Resolve Version') {
            steps {
                script {
                    env.BASE_VERSION = sh(
                        script: '''node -p "require('./app.json').expo.version"''',
                        returnStdout: true,
                    ).trim()
                    def baseVersionParts = env.BASE_VERSION.split(/[.]/)
                    if (baseVersionParts.size() != 3 || !baseVersionParts.every { it ==~ /[0-9]+/ }) {
                        error('app.json expo.version must use MAJOR.MINOR.PATCH format, such as 1.0.0.')
                    }
                    env.VERSION_CODE = env.BUILD_NUMBER
                    env.VERSION_NAME = "${baseVersionParts[0]}.${baseVersionParts[1]}.${env.BUILD_NUMBER}"
                    env.ARTIFACT_NAME = "hof-app-${env.BASE_VERSION}-build-${env.BUILD_NUMBER}-${env.GIT_SHORT}.apk"
                    env.EXTENSION_ARTIFACT_NAME = "hof-chrome-extension-${env.VERSION_NAME}-${env.GIT_SHORT}.zip"
                }
                sh '''#!/usr/bin/env bash
                    set -Eeuo pipefail

                    if ! printf '%s' "$BASE_VERSION" | grep -Eq '^[0-9]+[.][0-9]+[.][0-9]+$'; then
                        echo 'app.json expo.version must use MAJOR.MINOR.PATCH format, such as 1.0.0.' >&2
                        exit 1
                    fi
                    case "$VERSION_CODE" in
                        ''|*[!0-9]*) echo 'Jenkins BUILD_NUMBER must be a positive integer.' >&2; exit 1 ;;
                    esac
                    if [ "$VERSION_CODE" -lt 1 ] || [ "$VERSION_CODE" -gt 2100000000 ]; then
                        echo 'Generated Android versionCode must be between 1 and 2100000000.' >&2
                        exit 1
                    fi

                    printf 'Resolved release version: %s (versionCode %s)\n' \
                      "$VERSION_NAME" "$VERSION_CODE"
                '''
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''#!/usr/bin/env bash
                    set -Eeuo pipefail

                    install -d -m 755 "$HOF_CI_STATE_DIR"
                    dependency_hash="$({
                        sha256sum package.json
                        sha256sum package-lock.json
                    } | sha256sum | awk '{ print $1 }')"
                    dependency_marker="$HOF_CI_STATE_DIR/dependencies.sha256"

                    if [ -d node_modules ] && [ -x node_modules/.bin/expo ] && \
                       [ -r "$dependency_marker" ] && \
                       [ "$(cat "$dependency_marker")" = "$dependency_hash" ]; then
                        echo 'Dependency cache hit; reusing node_modules and native module build outputs.'
                    else
                        echo 'Dependency inputs changed or cache is missing; rebuilding node_modules.'
                        npm ci --no-audit --no-fund --prefer-offline
                        printf '%s\n' "$dependency_hash" > "$dependency_marker"
                    fi
                '''
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
                sh 'npm run typecheck'
                sh 'python3 -m unittest discover -s scripts -p "test_*.py"'
            }
        }

        stage('Build Chrome Extension') {
            steps {
                sh '''#!/usr/bin/env bash
                    set -Eeuo pipefail
                    HOF_VERSION_NAME="$VERSION_NAME" npm run build:extension
                    python3 scripts/package-chrome-extension.py dist "dist/$EXTENSION_ARTIFACT_NAME" "$VERSION_NAME"
                    sha256sum "dist/$EXTENSION_ARTIFACT_NAME" > "dist/$EXTENSION_ARTIFACT_NAME.sha256"
                '''
            }
        }

        stage('Build Signed APK') {
            steps {
                withCredentials([
                    file(
                        credentialsId: "${ANDROID_KEYSTORE_CREDENTIAL_ID}",
                        variable: 'HOF_ANDROID_KEYSTORE_FILE',
                    ),
                    string(
                        credentialsId: "${ANDROID_KEYSTORE_PASSWORD_CREDENTIAL_ID}",
                        variable: 'HOF_ANDROID_KEYSTORE_PASSWORD',
                    ),
                    file(
                        credentialsId: "${GOOGLE_SERVICES_CREDENTIAL_ID}",
                        variable: 'HOF_GOOGLE_SERVICES_FILE',
                    ),
                ]) {
                    sh '''#!/usr/bin/env bash
                        set -Eeuo pipefail

                        android_home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
                        export ANDROID_HOME="$android_home"
                        export HOF_VERSION_CODE="$VERSION_CODE"
                        export HOF_VERSION_NAME="$VERSION_NAME"
                        export HOF_ANDROID_KEY_ALIAS="$ANDROID_KEY_ALIAS"
                        export HOF_ANDROID_KEY_PASSWORD="$HOF_ANDROID_KEYSTORE_PASSWORD"
                        export NODE_ENV=production

                        install -m 600 "$HOF_GOOGLE_SERVICES_FILE" "$WORKSPACE/google-services.json"
                        install -d -m 755 "$GRADLE_USER_HOME/init.d"
                        install -m 644 \
                          "$WORKSPACE/.jenkins/gradle-cache-settings.init.gradle" \
                          "$GRADLE_USER_HOME/init.d/hof-cache-settings.init.gradle"

                        install -d -m 755 "$HOF_CI_STATE_DIR"
                        native_input_hash="$({
                            sha256sum package.json package-lock.json app.json app.config.js
                            find plugins -type f -print0 | sort -z | xargs -0 -r sha256sum
                        } | sha256sum | awk '{ print $1 }')"
                        native_input_marker="$HOF_CI_STATE_DIR/android-native-inputs.sha256"

                        if [ -x android/gradlew ] && \
                           [ -r "$native_input_marker" ] && \
                           [ "$(cat "$native_input_marker")" = "$native_input_hash" ]; then
                            echo 'Android native cache hit; updating generated configuration in place.'
                            npx expo prebuild --platform android --no-install
                        else
                            echo 'Android native inputs changed or cache is missing; regenerating native project.'
                            npx expo prebuild --platform android --clean --no-install
                            printf '%s\n' "$native_input_hash" > "$native_input_marker"
                        fi

                        ./android/gradlew -p android \
                          app:assembleRelease \
                          -PreactNativeArchitectures=arm64-v8a \
                          --build-cache \
                          --console=plain \
                          --parallel \
                          --max-workers=4

                        apk_source="$WORKSPACE/android/app/build/outputs/apk/release/app-release.apk"
                        test -s "$apk_source"

                        apksigner_path="$(find "$ANDROID_HOME/build-tools" -type f -name apksigner | sort -V | tail -1)"
                        test -x "$apksigner_path"
                        "$apksigner_path" verify --verbose "$apk_source"

                        certificate_output="$("$apksigner_path" verify --print-certs "$apk_source")"
                        actual_fingerprint="$(printf '%s\n' "$certificate_output" | \
                          awk -F': ' '/Signer.*certificate SHA-256 digest:/ && !found { \
                            print tolower($NF); found = 1 \
                          }')"
                        if [ "$actual_fingerprint" != "$EXPECTED_SIGNING_CERT_SHA256" ]; then
                            echo "Unexpected APK signing certificate: $actual_fingerprint" >&2
                            exit 1
                        fi

                        install -d -m 755 "$WORKSPACE/dist"
                        find "$WORKSPACE/dist" -maxdepth 1 -type f -name 'hof-*.apk' -delete
                        find "$WORKSPACE/dist" -maxdepth 1 -type f -name 'hof-*.apk.sha256' -delete
                        install -m 644 "$apk_source" "$WORKSPACE/dist/$ARTIFACT_NAME"
                        sha256sum "$WORKSPACE/dist/$ARTIFACT_NAME" > "$WORKSPACE/dist/$ARTIFACT_NAME.sha256"
                    '''
                }
            }
        }

        stage('Archive') {
            steps {
                archiveArtifacts(
                    artifacts: 'dist/*.apk,dist/*.zip,dist/*.sha256',
                    fingerprint: true,
                    onlyIfSuccessful: true,
                )
            }
        }

        stage('Publish APK') {
            steps {
                withCredentials([
                    sshUserPrivateKey(
                        credentialsId: "${SSH_CREDENTIAL_ID}",
                        keyFileVariable: 'SSH_KEY_FILE',
                    ),
                    string(
                        credentialsId: "${PUBLISH_TOKEN_CREDENTIAL_ID}",
                        variable: 'HOF_RELEASE_PUBLISH_TOKEN',
                    ),
                ]) {
                    sh '''#!/usr/bin/env bash
                        set -Eeuo pipefail

                        apk_path="$WORKSPACE/dist/$ARTIFACT_NAME"
                        test -s "$apk_path"
                        apk_size="$(stat -c '%s' "$apk_path")"
                        apk_sha256="$(sha256sum "$apk_path" | awk '{print $1}')"
                        remote_temp="/tmp/${ARTIFACT_NAME}.part-${BUILD_NUMBER}"
                        remote_final="$RELEASE_HOST_DIR/$ARTIFACT_NAME"
                        remote_final_part="${remote_final}.part-${BUILD_NUMBER}"

                        cleanup_remote() {
                            ssh -i "$SSH_KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes \
                              -o UserKnownHostsFile="$SSH_KNOWN_HOSTS_FILE" -o StrictHostKeyChecking=yes \
                              "$DEPLOY_TARGET" \
                              "rm -f -- '$remote_temp' '$remote_final_part'" >/dev/null 2>&1 || true
                        }
                        trap cleanup_remote EXIT

                        scp -i "$SSH_KEY_FILE" -o IdentitiesOnly=yes \
                          -o UserKnownHostsFile="$SSH_KNOWN_HOSTS_FILE" -o StrictHostKeyChecking=yes \
                          "$apk_path" "$DEPLOY_TARGET:$remote_temp"

                        ssh -i "$SSH_KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes \
                          -o UserKnownHostsFile="$SSH_KNOWN_HOSTS_FILE" -o StrictHostKeyChecking=yes \
                          "$DEPLOY_TARGET" \
                          "EXPECTED_SHA256='$apk_sha256' REMOTE_TEMP='$remote_temp' REMOTE_FINAL='$remote_final' REMOTE_FINAL_PART='$remote_final_part' RELEASE_HOST_DIR='$RELEASE_HOST_DIR' bash -s" <<'REMOTE_SCRIPT'
                        set -Eeuo pipefail
                        install -d -m 750 "$RELEASE_HOST_DIR"
                        actual_sha256="$(sha256sum "$REMOTE_TEMP" | awk '{print $1}')"
                        if [ "$actual_sha256" != "$EXPECTED_SHA256" ]; then
                            echo 'Transferred APK SHA-256 mismatch.' >&2
                            exit 1
                        fi
                        if [ -e "$REMOTE_FINAL" ]; then
                            existing_sha256="$(sha256sum "$REMOTE_FINAL" | awk '{print $1}')"
                            if [ "$existing_sha256" != "$EXPECTED_SHA256" ]; then
                                echo 'A different APK already exists with the release filename.' >&2
                                exit 1
                            fi
                            rm -f -- "$REMOTE_TEMP"
                        else
                            install -m 640 "$REMOTE_TEMP" "$REMOTE_FINAL_PART"
                            mv "$REMOTE_FINAL_PART" "$REMOTE_FINAL"
                            rm -f -- "$REMOTE_TEMP"
                        fi
REMOTE_SCRIPT

                        payload="$(printf \
                          '{"versionCode":%s,"versionName":"%s","fileName":"%s","fileSize":%s,"sha256":"%s","gitRevision":"%s","jenkinsBuild":%s}' \
                          "$VERSION_CODE" "$VERSION_NAME" "$ARTIFACT_NAME" "$apk_size" "$apk_sha256" "$GIT_REVISION" "$BUILD_NUMBER")"
                        curl --fail --silent --show-error \
                          --request POST \
                          --header 'Content-Type: application/json' \
                          --header "X-HOF-Release-Token: $HOF_RELEASE_PUBLISH_TOKEN" \
                          --data-binary "$payload" \
                          "$BACKEND_RELEASE_PUBLISH_URL"
                        printf '\nPublished APK: %s\n' "$ARTIFACT_NAME"
                    '''
                }
            }
        }
        stage('Publish Chrome Extension') {
            steps {
                withCredentials([
                    sshUserPrivateKey(
                        credentialsId: "${SSH_CREDENTIAL_ID}",
                        keyFileVariable: 'SSH_KEY_FILE',
                    ),
                ]) {
                    sh 'bash scripts/publish-chrome-extension.sh'
                }
            }
        }
    }

    post {
        always {
            sh '''#!/usr/bin/env bash
                rm -f -- "$WORKSPACE/google-services.json"

                echo 'Retained build cache sizes:'
                for cache_path in \
                  "$WORKSPACE/node_modules" \
                  "$WORKSPACE/android" \
                  "$GRADLE_USER_HOME"; do
                    if [ -d "$cache_path" ]; then
                        du -sh "$cache_path"
                    fi
                done
                df -h "$WORKSPACE" | tail -1
            '''
        }
        success {
            echo "HOF Android APK built successfully: version ${env.VERSION_NAME} (${env.VERSION_CODE})"
        }
        failure {
            echo 'HOF Android APK build failed. Check the failed stage above.'
        }
    }
}
