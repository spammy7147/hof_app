import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import React from 'react';
import { makeCaptchaPassResource } from '../fixtures/captchaPassResource';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name,
  { ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined) }, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const modules = Module as unknown as { _load: Loader };
const original = modules._load;
modules._load = (request, parent, isMain) => {
  if (request === 'lucide-react-native') return { ArrowLeft: host('ArrowLeft') };
  if (request === 'react-native') return {
    Pressable: host('Pressable'), ScrollView: host('ScrollView'), Switch: host('Switch'),
    Text: host('Text'), View: host('View'),
    StyleSheet: { create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style },
  };
  return original(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { SettingsTabScreen } = require('../../main/screens/SettingsTabScreen') as typeof import('../../main/screens/SettingsTabScreen');
modules._load = original;
afterEach(async () => rntl.cleanup());

it('인증 예약과 상태 확인 시각을 구분하고 직접 선택했을 때만 인증을 연다', async () => {
  const nextAuthenticationAt = '2026-11-18T11:30:00+09:00';
  const nextRefreshAt = '2026-11-18T10:01:00+09:00';
  let opened = 0;
  let refreshed = 0;
  const state = {
    enabled: true, authSuspended: false, passState: 'REQUIRED' as const,
    remainingSeconds: null, validUntil: null, observedAt: '2026-11-18T10:00:00+09:00',
    nextAuthenticationAt, nextRefreshAt, lastAttemptAt: null, lastResult: null,
    manualChallengeId: 91, lifecycleState: 'CHECK_SCHEDULED' as const, userActionRequired: false,
  };
  await rntl.render(React.createElement(SettingsTabScreen, {
    authenticated: true, onBack: () => undefined, onLogout: () => undefined,
    onOpenCaptcha: () => { opened++; },
    passMaintenance: makeCaptchaPassResource({ state, refresh: async () => { refreshed++; return state; } }),
  }));

  assert.ok(rntl.screen.getByText('다음 인증'));
  assert.ok(rntl.screen.getByText(new Date(nextAuthenticationAt).toLocaleString('ko-KR')));
  assert.ok(rntl.screen.getByText('다음 상태 확인'));
  assert.ok(rntl.screen.getByText(new Date(nextRefreshAt).toLocaleString('ko-KR')));
  assert.equal(opened, 0);
  const user = rntl.userEvent.setup();
  await user.press(rntl.screen.getByRole('button', { name: '상태 새로고침' }));
  assert.equal(refreshed, 1);
  assert.equal(opened, 0);
  await user.press(rntl.screen.getByRole('button', { name: '직접 인증' }));
  assert.equal(opened, 1);
});
