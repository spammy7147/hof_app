import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, Save, Trash2 } from 'lucide-react-native';

import { buildHomeQuestAutomationRequest } from '../../../domain/typedAutomation';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { theme } from '../../../styles/theme';
import type { HomeQuestResponse, HomeResponse, TypedAutomationEntryResponse, UpdateHomeQuestAutomationRequest } from '../../../types/api';

type Props = {
  entry: TypedAutomationEntryResponse;
  saving: boolean;
  mutationMessage: string | null;
  loadHome: () => Promise<HomeResponse>;
  onBack: () => void;
  onDelete: () => Promise<boolean>;
  onSave: (request: UpdateHomeQuestAutomationRequest) => Promise<boolean>;
};

const STATE_LABEL: Record<HomeQuestResponse['state'], string> = {
  AVAILABLE: '수락 가능', ACTIVE: '진행 중', CLAIMABLE: '완료 가능', COMPLETED: '완료', WAITING: '대기 중',
};

export function HomeQuestAutomationEditor({ entry, saving, mutationMessage, loadHome, onBack, onDelete, onSave }: Props) {
  const [enabled, setEnabled] = useState(entry.enabled);
  const [quests, setQuests] = useState<HomeQuestResponse[]>([]);
  const [selected, setSelected] = useState(() => new Set((entry.homeQuests ?? []).filter((quest) => quest.enabled).map((quest) => quest.questId)));
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadHome().then((response) => {
      if (!cancelled) { setQuests(response.quests); setError(null); }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(toUserFacingErrorMessage(cause));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadHome]);

  const storedById = useMemo(() => new Map((entry.homeQuests ?? []).map((quest) => [quest.questId, quest])), [entry.homeQuests]);
  const allQuests = useMemo(() => {
    const liveIds = new Set(quests.map((quest) => quest.id));
    return [
      ...quests,
      ...(entry.homeQuests ?? []).filter((quest) => !liveIds.has(quest.questId)).map((quest) => ({
        id: quest.questId, name: quest.questName, state: 'WAITING' as const, mission: null, reward: null, details: [], actionId: null,
      })),
    ].filter((quest) => `${quest.name} ${quest.mission ?? ''} ${quest.reward ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  }, [entry.homeQuests, query, quests]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    const source = [...quests, ...allQuests.filter((quest) => !quests.some((live) => live.id === quest.id))];
    const configured = source.filter((quest) => selected.has(quest.id)).map((quest, sourceOrder) => ({
      questId: quest.id,
      questName: quest.name || storedById.get(quest.id)?.questName || quest.id,
      enabled: true,
      sourceOrder,
    }));
    await onSave(buildHomeQuestAutomationRequest(enabled, configured));
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="자동화 설정으로" onPress={onBack} style={styles.iconButton}><ArrowLeft color={theme.colors.text} size={22} /></Pressable>
        <View style={styles.headerCopy}><Text style={styles.title}>자택 관리 자동화</Text><Text style={styles.subtitle}>수락·완료 가능한 자택 퀘스트를 화면 순서대로 처리합니다.</Text></View>
      </View>
      <View style={styles.enabledRow}><Text style={styles.enabledLabel}>자동화 사용</Text><Switch disabled={saving} onValueChange={setEnabled} value={enabled} /></View>
      <TextInput accessibilityLabel="자택 퀘스트 검색" onChangeText={setQuery} placeholder="작업명·조건·보상 검색" placeholderTextColor={theme.colors.textMuted} style={styles.search} value={query} />
      {mutationMessage || error ? <Text accessibilityLiveRegion="polite" style={styles.message}>{mutationMessage ?? error}</Text> : null}
      {loading ? <ActivityIndicator color={theme.colors.accentGreen} style={styles.loading} /> : (
        <FlatList
          contentContainerStyle={styles.list}
          data={allQuests}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(quest) => quest.id}
          ListEmptyComponent={<Text style={styles.empty}>표시할 자택 퀘스트가 없습니다.</Text>}
          renderItem={({ item }) => {
            const active = selected.has(item.id);
            return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: active }} onPress={() => toggle(item.id)} style={[styles.card, active && styles.cardSelected]}>
              <View style={styles.cardTitleRow}><Text style={styles.cardTitle}>{item.name}</Text>{active ? <Check color={theme.colors.accentGreen} size={19} /> : null}</View>
              <Text style={styles.state}>{STATE_LABEL[item.state]}</Text>
              {item.mission ? <Text style={styles.detail}>조건 · {item.mission}</Text> : null}
              {item.reward ? <Text style={styles.reward}>보상 · {item.reward}</Text> : null}
            </Pressable>;
          }}
        />
      )}
      <View style={styles.actions}>
        <Pressable disabled={saving} onPress={() => { void onDelete(); }} style={[styles.deleteButton, saving && styles.disabled]}><Trash2 color={theme.colors.danger} size={19} /><Text style={styles.deleteText}>삭제</Text></Pressable>
        <Pressable disabled={saving || loading} onPress={() => { void save(); }} style={[styles.saveButton, (saving || loading) && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.buttonText} /> : <><Save color={theme.colors.buttonText} size={19} /><Text style={styles.saveText}>저장</Text></>}</Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.colors.background, flex: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.md, marginBottom: theme.spacing.lg },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  headerCopy: { flex: 1 }, title: { color: theme.colors.text, fontSize: 22, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  enabledRow: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.md, padding: theme.spacing.md },
  enabledLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  search: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: theme.colors.text, fontSize: 14, marginBottom: theme.spacing.sm, minHeight: 48, paddingHorizontal: theme.spacing.md },
  message: { color: theme.colors.accentAmber, fontSize: 12, marginBottom: theme.spacing.sm }, loading: { flex: 1 },
  list: { gap: theme.spacing.sm, paddingBottom: theme.spacing.lg }, empty: { color: theme.colors.textMuted, padding: theme.spacing.xl, textAlign: 'center' },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, padding: theme.spacing.md },
  cardSelected: { borderColor: theme.colors.accentGreen, borderWidth: 2 }, cardTitleRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  cardTitle: { color: theme.colors.text, flex: 1, fontSize: 15, fontWeight: '900' }, state: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800', marginTop: 6 },
  detail: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 6 }, reward: { color: theme.colors.accentAmber, fontSize: 12, lineHeight: 18, marginTop: 4 },
  actions: { borderTopColor: theme.colors.border, borderTopWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, paddingBottom: theme.spacing.lg, paddingTop: theme.spacing.sm },
  deleteButton: { alignItems: 'center', borderColor: theme.colors.danger, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 52, paddingHorizontal: theme.spacing.md },
  deleteText: { color: theme.colors.danger, fontSize: 14, fontWeight: '900' }, saveButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 52 },
  saveText: { color: theme.colors.buttonText, fontSize: 15, fontWeight: '900' }, disabled: { opacity: 0.45 },
});
