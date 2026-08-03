const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// HOF_RELEASE_SIGNING_CONFIG';

const SIGNING_PROPERTIES = `${MARKER}
def hofReleaseStoreFile = findProperty('HOF_ANDROID_KEYSTORE_FILE') ?: System.getenv('HOF_ANDROID_KEYSTORE_FILE')
def hofReleaseStorePassword = findProperty('HOF_ANDROID_KEYSTORE_PASSWORD') ?: System.getenv('HOF_ANDROID_KEYSTORE_PASSWORD')
def hofReleaseKeyAlias = findProperty('HOF_ANDROID_KEY_ALIAS') ?: System.getenv('HOF_ANDROID_KEY_ALIAS')
def hofReleaseKeyPassword = findProperty('HOF_ANDROID_KEY_PASSWORD') ?: System.getenv('HOF_ANDROID_KEY_PASSWORD')
def hofReleaseSigningValues = [
    hofReleaseStoreFile,
    hofReleaseStorePassword,
    hofReleaseKeyAlias,
    hofReleaseKeyPassword,
]
def hofReleaseSigningConfigured = hofReleaseSigningValues.every { value -> value != null && !value.toString().isBlank() }
def hofReleaseSigningPartiallyConfigured = hofReleaseSigningValues.any { value -> value != null && !value.toString().isBlank() } && !hofReleaseSigningConfigured

if (hofReleaseSigningPartiallyConfigured) {
    throw new GradleException('HOF Android release signing credentials must be provided together.')
}

`;

const RELEASE_SIGNING_CONFIG = `        release {
            if (hofReleaseSigningConfigured) {
                storeFile file(hofReleaseStoreFile)
                storePassword hofReleaseStorePassword
                keyAlias hofReleaseKeyAlias
                keyPassword hofReleaseKeyPassword
            }
        }
`;

const RELEASE_SIGNING_VALIDATION = `
def verifyHofReleaseSigning = tasks.register('verifyHofReleaseSigning') {
    doLast {
        if (!hofReleaseSigningConfigured) {
            throw new GradleException(
                'Release signing is not configured. Set HOF_ANDROID_KEYSTORE_FILE, ' +
                    'HOF_ANDROID_KEYSTORE_PASSWORD, HOF_ANDROID_KEY_ALIAS, and HOF_ANDROID_KEY_PASSWORD.'
            )
        }
    }
}

tasks.configureEach { task ->
    if (task.name == 'preReleaseBuild') {
        task.dependsOn(verifyHofReleaseSigning)
    }
}
`;

function addReleaseSigning(buildGradle) {
  if (buildGradle.includes(MARKER)) {
    return buildGradle;
  }

  let updated = buildGradle.replace('android {', `${SIGNING_PROPERTIES}android {`);
  if (updated === buildGradle) {
    throw new Error('Unable to locate the Android Gradle configuration block.');
  }

  const debugSigningConfig = /(signingConfigs\s*\{[\s\S]*?debug\s*\{[\s\S]*?^\s{8}\})/m;
  if (!debugSigningConfig.test(updated)) {
    throw new Error('Unable to locate the generated debug signing configuration.');
  }
  updated = updated.replace(debugSigningConfig, `$1\n${RELEASE_SIGNING_CONFIG.trimEnd()}`);

  const releaseBuildType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseBuildType.test(updated)) {
    throw new Error('Unable to locate the generated release build type signing configuration.');
  }
  updated = updated.replace(releaseBuildType, '$1signingConfig signingConfigs.release');

  return `${updated.trimEnd()}\n${RELEASE_SIGNING_VALIDATION}`;
}

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('HOF Android release signing requires a Groovy app/build.gradle file.');
    }

    gradleConfig.modResults.contents = addReleaseSigning(gradleConfig.modResults.contents);
    return gradleConfig;
  });
};

module.exports.addReleaseSigning = addReleaseSigning;
