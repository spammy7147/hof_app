import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { CaptchaPassMaintenanceResponse } from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) =>
  React.createElement(name, props, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    Pressable: host('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Switch: host('Switch'),
    Text: host('Text'),
    View: host('View'),
  };
  if (request === 'lucide-react-native') return { ArrowLeft: host('ArrowLeft') };
  if (request.endsWith('/components/PrimaryButton')) return { PrimaryButton: host('PrimaryButton') };
  return originalLoad(request, parent, isMain);
};
const { SettingsTabScreen } = require(
  '../../main/screens/SettingsTabScreen',
) as typeof import('../../main/screens/SettingsTabScreen');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SettingsTabScreen pass maintenance controls', () => {
  it('wires refresh, policy switch, and manual challenge actions to the account-wide state', async () => {
    const toggles: boolean[] = [];
    let refreshes = 0;
    let manualOpens = 0;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(SettingsTabScreen, {
        authenticated: true,
        onBack: () => undefined,
        onLogout: () => undefined,
        onOpenCaptcha: () => { manualOpens += 1; },
        passMaintenance: manualRequiredState(),
        onRefreshPassMaintenance: async () => { refreshes += 1; },
        onTogglePassMaintenance: async (enabled: boolean) => { toggles.push(enabled); },
      }));
    });

    const policySwitch = renderer.root.find((node) => String(node.type) === 'Switch');
    const refresh = renderer.root.findByProps({ label: '상태 새로고침' });
    const manual = renderer.root.findByProps({ label: '직접 인증' });
    assert.equal(policySwitch.props.disabled, false);
    assert.equal(manual.props.disabled, false);

    await act(async () => {
      policySwitch.props.onValueChange(false);
      refresh.props.onPress();
      manual.props.onPress();
      await Promise.resolve();
    });

    assert.deepEqual(toggles, [false]);
    assert.equal(refreshes, 1);
    assert.equal(manualOpens, 1);
  });
});

function manualRequiredState(): CaptchaPassMaintenanceResponse {
  return {
    enabled: true,
    authSuspended: false,
    passState: 'REQUIRED',
    remainingSeconds: null,
    validUntil: null,
    observedAt: '2026-08-26T00:00:00Z',
    nextRefreshAt: null,
    lastAttemptAt: '2026-08-26T00:00:00Z',
    lastResult: 'MANUAL_REQUIRED',
    manualChallengeId: 91,
    lifecycleState: 'MANUAL_INPUT_REQUIRED',
    userActionRequired: true,
  };
}
