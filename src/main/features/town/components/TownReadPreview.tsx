import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TownApi } from '../api/townApi';
import { TownItemList } from './TownItemList';
import { theme } from '../../../styles/theme';

const subscribeToNothing = () => () => undefined;

/** 실제 panel은 최신 조회를 계속하며, 완료 전에는 실행 권한 없는 표시 자료만 노출한다. */
export function TownReadPreview({ api, path, virtualized, children }: {
  api: TownApi; path: string; virtualized: boolean; children: ReactNode;
}) {
  const [snapshot] = useState(() => api.peekPreview?.(path) ?? null);
  const read = useSyncExternalStore(api.subscribeReads ?? subscribeToNothing, () => api.getReadState?.(path) ?? null);
  const initialRevision = useRef(read ? read.revision - Number(read.status === 'loading') : 0);
  const [verified, setVerified] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!snapshot || verified || read?.status !== 'ready' || read.revision <= initialRevision.current) return undefined;
    // 공용 읽기 완료를 받은 실제 panel의 state 갱신까지 끝낸 다음 표시를 넘긴다.
    const timer = setTimeout(() => setVerified(true), 0);
    return () => clearTimeout(timer);
  }, [read, snapshot, verified]);
  if (!snapshot) return children;
  const showingPreview = !verified;
  const failed = read?.status === 'error' && !read.awaitingCaptcha;
  const visibleRows = virtualized ? snapshot.rows : snapshot.rows.slice(0, 12);
  return <View style={styles.container}>
    {showingPreview ? <View style={styles.container} accessibilityLabel="이전 조회 자료">
      <Text accessibilityLiveRegion="polite" style={styles.hint}>이전 목록 표시 중 · 최신 확인 전에는 실행할 수 없습니다.</Text>
      <Text style={styles.hint}>마지막 확인 {new Date(snapshot.verifiedAt).toLocaleTimeString()}</Text>
      {snapshot.notices.map((notice, index) => <Text key={index} style={styles.hint}>{notice}</Text>)}
      <Text style={failed ? styles.error : styles.hint}>{read?.awaitingCaptcha ? 'HOF 인증을 기다리는 중...' : failed ? read.error : '최신 정보를 확인하는 중...'}</Text>
      {failed ? <Pressable accessibilityRole="button" accessibilityLabel="최신 정보 다시 확인" onPress={() => setAttempt((value) => value + 1)} style={styles.retry}><Text style={styles.retryText}>다시 확인</Text></Pressable> : null}
      {snapshot.totalRows > visibleRows.length ? <Text style={styles.hint}>이전 목록 일부입니다. 전체 목록은 최신 확인 후 표시합니다.</Text> : null}
      {virtualized ? <TownItemList rows={visibleRows} selectionMode="none" emptyMessage="지난 조회에서 표시할 항목이 없었습니다." /> : <View>{visibleRows.map((row) => <Text key={row.id} style={styles.hint}>{row.label}</Text>)}</View>}
    </View> : null}
    <View style={showingPreview ? styles.hidden : styles.container} pointerEvents={showingPreview ? 'none' : 'auto'} accessibilityElementsHidden={showingPreview} importantForAccessibility={showingPreview ? 'no-hide-descendants' : 'auto'}>
      <Fragment key={attempt}>{children}</Fragment>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, gap: theme.spacing.sm }, hidden: { display: 'none' },
  hint: { color: theme.colors.textMuted, lineHeight: 20 }, error: { color: theme.colors.danger, lineHeight: 20 },
  retry: { alignSelf: 'flex-start', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, padding: theme.spacing.sm },
  retryText: { color: theme.colors.background, fontWeight: '800' },
});
