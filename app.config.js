const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

function resolveVersionCode(rawValue, fallbackValue) {
  if (rawValue === undefined || rawValue === '') {
    return fallbackValue;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error('HOF_VERSION_CODE must be a positive integer.');
  }

  const versionCode = Number(rawValue);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > MAX_ANDROID_VERSION_CODE) {
    throw new Error(`HOF_VERSION_CODE must be between 1 and ${MAX_ANDROID_VERSION_CODE}.`);
  }

  return versionCode;
}

function resolveVersionName(rawValue, fallbackValue) {
  if (rawValue === undefined || rawValue === '') {
    return fallbackValue;
  }

  const versionName = rawValue.trim();
  if (versionName.length === 0 || versionName.length > 100) {
    throw new Error('HOF_VERSION_NAME must contain between 1 and 100 characters.');
  }

  return versionName;
}

module.exports = ({ config }) => ({
  ...config,
  version: resolveVersionName(process.env.HOF_VERSION_NAME, config.version),
  android: {
    ...config.android,
    versionCode: resolveVersionCode(process.env.HOF_VERSION_CODE, config.android?.versionCode ?? 1),
  },
});
