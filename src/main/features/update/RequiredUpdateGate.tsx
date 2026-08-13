import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import type { BackendApiClient } from '../../services/backendApi';
import type { AndroidReleaseResponse } from '../../types/api';
import { theme } from '../../styles/theme';

type UpdateApi = Pick<BackendApiClient, 'fetchLatestAndroidRelease'>;

type Props = {
  api: UpdateApi;
  children: ReactNode;
};

type GateState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'required'; release: AndroidReleaseResponse; message: string | null }
  | { kind: 'checkingFailed'; message: string }
  | { kind: 'installing'; release: AndroidReleaseResponse };

/** 운영 Android APK가 최신 필수 버전인지 확인하기 전에는 앱 본문을 마운트하지 않는다. */
export function RequiredUpdateGate({ api, children }: Props) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const isOpeningInstallerRef = useRef(false);
  const lastCheckedAtRef = useRef(0);

  const checkForUpdate = useCallback(async (
    message: string | null = null,
    silent = false,
  ) => {
    if (Platform.OS !== 'android' || process.env.NODE_ENV !== 'production') {
      setState({ kind: 'ready' });
      return;
    }

    if (!silent) setState({ kind: 'checking' });
    lastCheckedAtRef.current = Date.now();
    try {
      const currentVersionCode = parseAndroidVersionCode(Application.nativeBuildVersion);
      const latest = await api.fetchLatestAndroidRelease(currentVersionCode);
      if (latest.release.versionCode > currentVersionCode) {
        setState({ kind: 'required', release: latest.release, message });
      } else {
        setState({ kind: 'ready' });
      }
    } catch {
      if (silent) return;
      setState({
        kind: 'checkingFailed',
        message: '최신 버전을 확인하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
      });
    }
  }, [api]);

  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  useEffect(() => {
    if (Platform.OS !== 'android' || process.env.NODE_ENV !== 'production') return undefined;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (
        nextState === 'active'
        && !isOpeningInstallerRef.current
        && Date.now() - lastCheckedAtRef.current >= ACTIVE_RECHECK_INTERVAL_MS
      ) {
        void checkForUpdate(null, true);
      }
    });
    return () => subscription.remove();
  }, [checkForUpdate]);

  const blocked = state.kind !== 'ready' && state.kind !== 'checking';
  useEffect(() => {
    if (!blocked || Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => subscription.remove();
  }, [blocked]);

  const installUpdate = useCallback(async (release: AndroidReleaseResponse) => {
    setState({ kind: 'installing', release });
    let downloadedApk: string | null = null;
    try {
      const cacheDirectory = FileSystem.cacheDirectory;
      if (!cacheDirectory) throw new Error('APK cache directory is unavailable.');
      const destination = `${cacheDirectory}hof-update-${release.versionCode}.apk`;
      await FileSystem.deleteAsync(destination, { idempotent: true });
      const download = await FileSystem.downloadAsync(release.downloadUrl, destination);
      downloadedApk = download.uri;
      if (download.status < 200 || download.status >= 300) {
        throw new Error(`APK download failed with HTTP ${download.status}.`);
      }
      const contentUri = await FileSystem.getContentUriAsync(download.uri);
      isOpeningInstallerRef.current = true;
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1,
        type: APK_MEDIA_TYPE,
      }).catch(() => undefined);
      await FileSystem.deleteAsync(download.uri, { idempotent: true }).catch(() => undefined);
      // 설치를 완료하거나 취소해 설치 화면에서 돌아오면 현재 프로세스를 종료한다.
      // 사용자가 앱을 다시 실행했을 때 설치된 versionCode로 다시 검사한다.
      BackHandler.exitApp();
    } catch {
      if (downloadedApk) {
        await FileSystem.deleteAsync(downloadedApk, { idempotent: true }).catch(() => undefined);
      }
      isOpeningInstallerRef.current = false;
      setState({
        kind: 'required',
        release,
        message: '업데이트 파일을 내려받거나 설치 화면을 열지 못했습니다. 다시 시도해 주세요.',
      });
    }
  }, []);

  if (state.kind === 'ready') return children;

  if (state.kind === 'checking') {
    return (
      <UpdateScreen
        description="최신 앱 버전을 확인하고 있습니다."
        title="버전 확인 중"
      />
    );
  }

  if (state.kind === 'checkingFailed') {
    return (
      <UpdateScreen
        description={state.message}
        primaryLabel="다시 확인"
        onPrimary={() => { void checkForUpdate(); }}
        onExit={BackHandler.exitApp}
        title="버전 확인 필요"
      />
    );
  }

  const release = state.release;
  const installing = state.kind === 'installing';
  return (
    <UpdateScreen
      description={state.kind === 'required' && state.message
        ? state.message
        : `새 버전 ${formatReleaseVersionName(release.versionName)}이 준비되었습니다. 업데이트 후 앱을 이용할 수 있습니다.`}
      installing={installing}
      primaryLabel="업데이트"
      onPrimary={() => { void installUpdate(release); }}
      onExit={BackHandler.exitApp}
      title="필수 업데이트"
    />
  );
}

type UpdateScreenProps = {
  title: string;
  description: string;
  primaryLabel?: string;
  installing?: boolean;
  onPrimary?: () => void;
  onExit?: () => void;
};

function UpdateScreen({
  title,
  description,
  primaryLabel,
  installing = false,
  onPrimary,
  onExit,
}: UpdateScreenProps) {
  return (
    <View style={styles.screen}>
      <View accessibilityViewIsModal style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {primaryLabel && onPrimary ? (
          <PrimaryButton
            label={installing ? '업데이트 준비 중' : primaryLabel}
            loading={installing}
            onPress={onPrimary}
            style={styles.button}
          />
        ) : null}
        {onExit ? (
          <PrimaryButton
            disabled={installing}
            label="앱 종료"
            onPress={onExit}
            variant="secondary"
            style={styles.button}
          />
        ) : null}
      </View>
      <StatusBar style="light" />
    </View>
  );
}

export function parseAndroidVersionCode(nativeBuildVersion: string | null): number {
  if (nativeBuildVersion == null || !/^\d+$/.test(nativeBuildVersion)) {
    throw new Error('Android versionCode is unavailable.');
  }
  const versionCode = Number(nativeBuildVersion);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) {
    throw new Error('Android versionCode is invalid.');
  }
  return versionCode;
}

export function formatReleaseVersionName(versionName: string): string {
  const legacy = /^(\d+)\.(\d+)\.0\+(\d+)$/.exec(versionName.trim());
  return legacy ? `${legacy[1]}.${legacy[2]}.${legacy[3]}` : versionName;
}

const APK_MEDIA_TYPE = 'application/vnd.android.package-archive';
const ACTIVE_RECHECK_INTERVAL_MS = 60_000;

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    maxWidth: 480,
    padding: theme.spacing.xl,
    width: '100%',
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: theme.spacing.xl,
    textAlign: 'center',
  },
  button: {
    marginTop: theme.spacing.sm,
  },
});
