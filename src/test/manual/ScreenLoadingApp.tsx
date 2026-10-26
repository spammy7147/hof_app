import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Platform, SafeAreaView, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BackendApiClient } from '../../main/services/backendApi';
import { createTownApi } from '../../main/features/town/api/townApi';
import { useBattleResource } from '../../main/features/battle/useBattleResource';
import { ShopPanel } from '../../main/features/town/panels/ShopPanel';
import { PantheonPanel } from '../../main/features/town/panels/PantheonPanel';
import { CardPanel } from '../../main/features/town/panels/CardPanel';
import { BattleTabScreen } from '../../main/screens/BattleTabScreen';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';

/** 실제 화면·인증 client를 로컬 HTTP fixture에만 연결하는 별도 검증 앱이다. 운영 주소를 받지 않는다. */
const base = 'http://127.0.0.1:3009';
const catalog = makePartyPresetCatalogResource({ folders: [], presets: [] });
const describeError = (error: unknown) => String(error);
type Panel = '숨김' | '상점' | '맵' | '신전' | '카드';

function Session({ account, switchAccount }: { account: string; switchAccount: () => void }) {
  const active = useRef(true);
  const [ready, setReady] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('숨김');
  const [captcha, setCaptcha] = useState<(() => void) | null>(null);
  const client = useMemo(() => {
    let refreshToken: string | null = null;
    return new BackendApiClient(base, {
      load: async () => refreshToken,
      save: async (token) => { refreshToken = token; },
      remove: async () => { refreshToken = null; },
    });
  }, []);
  const api = useMemo(() => createTownApi(client), [client]);
  const assertActiveGeneration = useMemo(() => () => { if (!active.current) throw new Error('종료한 검증 세대'); }, []);
  const resolveCaptcha = useMemo(() => () => new Promise<void>((resolve) => setCaptcha(() => resolve)), []);
  const battle = useBattleResource({ api: client, assertActiveGeneration, describeError, waitForCaptchaResolution: resolveCaptcha });
  useEffect(() => {
    void client.login({ loginId: account, password: 'local-fixture-only' }).then(() => { if (active.current) setReady(true); }).catch((error: unknown) => {
      if (active.current) setLoginError(describeError(error));
    });
    return () => { active.current = false; api.dispose(); client.dispose(); };
  }, [account, api, client]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#f3f5f8' }}>
    <Text accessibilityLabel="검증 계정" style={{ padding: 8 }}>로컬 화면 검증 · {account} · {Platform.OS}</Text>
    {loginError && <Text accessibilityLabel="검증 로그인 오류">{loginError}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {(['숨김', '상점', '맵', '신전', '카드'] as const).map((name) => <Button key={name} title={name} disabled={!ready} onPress={() => setPanel(name)} />)}
      <Button title="계정 전환" onPress={switchAccount} />
    </View>
    <View style={{ flex: 1 }}>
      {panel === '상점' && <ShopPanel api={api} mode="general" resolveCaptcha={resolveCaptcha} />}
      {panel === '맵' && <BattleTabScreen authenticated battle={battle} characters={[]} partyPresetCatalog={catalog} />}
      {panel === '신전' && <PantheonPanel api={api} resolveCaptcha={resolveCaptcha} />}
      {panel === '카드' && <CardPanel api={api} mode="upgrade" resolveCaptcha={resolveCaptcha} />}
    </View>
    <Modal visible={captcha != null} transparent onRequestClose={() => undefined}>
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#eeeeee' }}>
        <Text>로컬 인증 대기 · 실제 CAPTCHA가 아닙니다</Text>
        <Button title="검증 인증 완료" onPress={() => { captcha?.(); setCaptcha(null); }} />
        <Button title="인증 중 화면 이탈" onPress={() => setPanel('숨김')} />
      </View>
    </Modal>
  </SafeAreaView>;
}

function ScreenLoadingApp() {
  const [account, setAccount] = useState('fixture-A');
  return <SafeAreaProvider><Session key={account} account={account} switchAccount={() => setAccount((old) => old === 'fixture-A' ? 'fixture-B' : 'fixture-A')} /></SafeAreaProvider>;
}
registerRootComponent(ScreenLoadingApp);
