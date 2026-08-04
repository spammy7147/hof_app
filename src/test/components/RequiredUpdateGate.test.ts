import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));

let nativeBuildVersion: string | null = '46';
let hardwareBackHandler: (() => boolean) | null = null;
let appStateHandler: ((state: string) => void) | null = null;
let exitCalls = 0;
let downloadedUrl: string | null = null;
let deletedFiles: string[] = [];
let launchedIntent: { action: string; params: Record<string, unknown> } | null = null;

type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') {
    return {
      AppState: {
        addEventListener: (_event: string, handler: (state: string) => void) => {
          appStateHandler = handler;
          return { remove: () => { if (appStateHandler === handler) appStateHandler = null; } };
        },
      },
      BackHandler: {
        addEventListener: (_event: string, handler: () => boolean) => {
          hardwareBackHandler = handler;
          return { remove: () => { if (hardwareBackHandler === handler) hardwareBackHandler = null; } };
        },
        exitApp: () => { exitCalls += 1; },
      },
      Platform: { OS: 'android' },
      StyleSheet: { create: <T,>(styles: T) => styles },
      Text: host('Text'),
      View: host('View'),
    };
  }
  if (request === 'expo-application') {
    return { get nativeBuildVersion() { return nativeBuildVersion; } };
  }
  if (request === 'expo-file-system/legacy') {
    return {
      cacheDirectory: 'file:///cache/',
      deleteAsync: async (uri: string) => { deletedFiles.push(uri); },
      downloadAsync: async (url: string, destination: string) => {
        downloadedUrl = url;
        return { uri: destination, status: 200, headers: {}, mimeType: null };
      },
      getContentUriAsync: async () => 'content://hof/update.apk',
    };
  }
  if (request === 'expo-intent-launcher') {
    return {
      startActivityAsync: async (action: string, params: Record<string, unknown>) => {
        launchedIntent = { action, params };
        return { resultCode: 0 };
      },
    };
  }
  if (request === 'expo-status-bar') return { StatusBar: host('StatusBar') };
  if (request.endsWith('/components/PrimaryButton')) return { PrimaryButton: host('PrimaryButton') };
  return originalLoad(request, parent, isMain);
};
const { RequiredUpdateGate, parseAndroidVersionCode } = require(
  '../../main/features/update/RequiredUpdateGate',
) as typeof import('../../main/features/update/RequiredUpdateGate');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalNodeEnv = process.env.NODE_ENV;

after(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

afterEach(() => {
  nativeBuildVersion = '46';
  hardwareBackHandler = null;
  appStateHandler = null;
  exitCalls = 0;
  downloadedUrl = null;
  deletedFiles = [];
  launchedIntent = null;
});

describe('RequiredUpdateGate', () => {
  it('uses the native Android versionCode and mounts the app only when it is current', async () => {
    process.env.NODE_ENV = 'production';
    const api = {
      fetchLatestAndroidRelease: async (currentVersionCode: number) => {
        assert.equal(currentVersionCode, 46);
        return latestRelease(46);
      },
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          RequiredUpdateGate,
          { api: api as never, children: React.createElement(ViewMarker) },
        ),
      );
      await Promise.resolve();
    });

    assert.equal(renderer.root.findAllByType(ViewMarker).length, 1);
    await act(async () => { renderer.unmount(); });
  });

  it('blocks the app, downloads the APK, opens the installer, and exits on refusal', async () => {
    process.env.NODE_ENV = 'production';
    const api = { fetchLatestAndroidRelease: async () => latestRelease(47) };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          RequiredUpdateGate,
          { api: api as never, children: React.createElement(ViewMarker) },
        ),
      );
      await Promise.resolve();
    });

    assert.equal(renderer.root.findAllByType(ViewMarker).length, 0);
    const updateButton = renderer.root.find(
      (node) => String(node.type) === 'PrimaryButton' && node.props.label === '업데이트',
    );
    await act(async () => {
      updateButton.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(downloadedUrl, 'https://backend.test/api/app-releases/android/47/download');
    assert.deepEqual(launchedIntent, {
      action: 'android.intent.action.VIEW',
      params: {
        data: 'content://hof/update.apk',
        flags: 1,
        type: 'application/vnd.android.package-archive',
      },
    });
    assert.equal(exitCalls, 1);
    assert.deepEqual(deletedFiles, [
      'file:///cache/hof-update-47.apk',
      'file:///cache/hof-update-47.apk',
    ]);
    assert.equal(hardwareBackHandler?.(), true);
    assert.equal(exitCalls, 2);
    await act(async () => { renderer.unmount(); });
  });

  it('rechecks when the app becomes active after the foreground interval', async () => {
    process.env.NODE_ENV = 'production';
    let checks = 0;
    const api = {
      fetchLatestAndroidRelease: async () => {
        checks += 1;
        return latestRelease(46);
      },
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          RequiredUpdateGate,
          { api: api as never, children: React.createElement(ViewMarker) },
        ),
      );
      await Promise.resolve();
    });

    assert.equal(checks, 1);
    await act(async () => {
      appStateHandler?.('active');
      await Promise.resolve();
    });
    assert.equal(checks, 1);

    const originalNow = Date.now;
    Date.now = () => originalNow() + 60_001;
    try {
      await act(async () => {
        appStateHandler?.('active');
        await Promise.resolve();
      });
    } finally {
      Date.now = originalNow;
    }
    assert.equal(checks, 2);
    await act(async () => { renderer.unmount(); });
  });

  it('keeps the current app screen mounted while an active-state recheck runs', async () => {
    process.env.NODE_ENV = 'production';
    const recheck = deferred<ReturnType<typeof latestRelease>>();
    let checks = 0;
    const api = {
      fetchLatestAndroidRelease: async () => {
        checks += 1;
        return checks === 1 ? latestRelease(46) : recheck.promise;
      },
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          RequiredUpdateGate,
          { api: api as never, children: React.createElement(ViewMarker) },
        ),
      );
      await Promise.resolve();
    });

    const originalNow = Date.now;
    Date.now = () => originalNow() + 60_001;
    try {
      await act(async () => {
        appStateHandler?.('active');
        await Promise.resolve();
      });
      assert.equal(checks, 2);
      assert.equal(renderer.root.findAllByType(ViewMarker).length, 1);

      await act(async () => {
        recheck.resolve(latestRelease(46));
        await recheck.promise;
      });
      assert.equal(renderer.root.findAllByType(ViewMarker).length, 1);
    } finally {
      Date.now = originalNow;
    }
    await act(async () => { renderer.unmount(); });
  });

  it('shows the update screen only when an active-state recheck finds a new release', async () => {
    process.env.NODE_ENV = 'production';
    let checks = 0;
    const api = {
      fetchLatestAndroidRelease: async () => {
        checks += 1;
        return latestRelease(checks === 1 ? 46 : 47);
      },
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          RequiredUpdateGate,
          { api: api as never, children: React.createElement(ViewMarker) },
        ),
      );
      await Promise.resolve();
    });

    const originalNow = Date.now;
    Date.now = () => originalNow() + 60_001;
    try {
      await act(async () => {
        appStateHandler?.('active');
        await Promise.resolve();
      });
    } finally {
      Date.now = originalNow;
    }

    assert.equal(renderer.root.findAllByType(ViewMarker).length, 0);
    assert.equal(renderer.root.findAll(
      (node) => String(node.type) === 'PrimaryButton' && node.props.label === '업데이트',
    ).length, 1);
    await act(async () => { renderer.unmount(); });
  });

  it('rejects missing or malformed native build versions', () => {
    assert.equal(parseAndroidVersionCode('47'), 47);
    assert.throws(() => parseAndroidVersionCode(null));
    assert.throws(() => parseAndroidVersionCode('1.0.0'));
  });
});

function ViewMarker() {
  return React.createElement('ViewMarker');
}

function latestRelease(versionCode: number) {
  return {
    updateAvailable: versionCode > 46,
    release: {
      versionCode,
      versionName: `1.0.0+${versionCode}`,
      fileSize: 1024,
      sha256: 'a'.repeat(64),
      gitRevision: 'b'.repeat(40),
      jenkinsBuild: versionCode,
      publishedAt: '2026-08-03T00:00:00Z',
      downloadUrl: `https://backend.test/api/app-releases/android/${versionCode}/download`,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
