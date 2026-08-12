import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ArrowLeft, Save } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';

import type { PartyPresetCatalogResource } from '../../../domain/partyPresetCatalogLoader';
import { formatAutomationPresetSelection } from '../../../domain/partyPresets';
import { AUTOMATION_TYPE_METADATA } from '../../../domain/typedAutomation';
import { theme } from '../../../styles/theme';
import type {
  BattleMapResponse, PresetSelection, RaidPubResponse, TypedAutomationEntryResponse,
  UpdateFishingAutomationRequest, UpdateRaidAutomationRequest, UpdateUnionAutomationRequest,
} from '../../../types/api';
import { BattleMapPresetPickerModal } from './BattleMapPresetPickerModal';

type SaveRequest = UpdateFishingAutomationRequest | UpdateRaidAutomationRequest | UpdateUnionAutomationRequest;
type Props = {
  entry: TypedAutomationEntryResponse; saving: boolean; mutationMessage: string | null;
  onBack: () => void; onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onLoadRaidTargets: () => Promise<RaidPubResponse>;
  partyPresetCatalog: PartyPresetCatalogResource; onSave: (request: SaveRequest) => Promise<boolean>;
};
type SelectedTarget = { key: string; name: string; preset: PresetSelection };
type AvailableTarget = { key: string; name: string };

export function NewAutomationEditor({ entry, saving, mutationMessage, onBack, onLoadBattleMaps, onLoadRaidTargets, partyPresetCatalog, onSave }: Props) {
  const [enabled, setEnabled] = useState(entry.enabled);
  const [catalog, setCatalog] = useState<AvailableTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePresetKey, setActivePresetKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedTarget[]>(() => {
    if (entry.type === 'FISHING') return (entry.fishingMaps ?? []).map((item) => ({ key: item.mapCode, name: item.displayName ?? item.mapCode, preset: item }));
    if (entry.type === 'UNION') return (entry.unionMaps ?? []).map((item) => ({ key: item.mapCode, name: item.displayName ?? item.mapCode, preset: item }));
    if (entry.type === 'RAID') return (entry.raidTargets ?? []).map((item) => ({ key: item.raidId, name: item.displayName, preset: item }));
    return [];
  });
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const request = entry.type === 'FISHING'
      ? onLoadBattleMaps('battle_map').then((maps) => maps
        .filter((map): map is BattleMapResponse & { mapCode: string } => Boolean(
          map.mapCode && map.enabled && map.resolved && isFishingBattleMap(map),
        ))
        .map((map) => ({ key: map.mapCode, name: map.name })))
      : entry.type === 'UNION'
      ? onLoadBattleMaps('union').then((maps) => maps
        .filter((map): map is BattleMapResponse & { mapCode: string } => Boolean(map.mapCode && map.enabled && map.resolved))
        .map((map) => ({ key: map.mapCode, name: map.name })))
      : onLoadRaidTargets().then((pub) => pub.raids
        .filter(({ playable }) => playable)
        .map((raid) => ({ key: raid.id, name: raid.name })));
    void request.then((targets) => { if (active) setCatalog(targets); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '목록을 불러오지 못했습니다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [entry.type, onLoadBattleMaps, onLoadRaidTargets]);
  useEffect(() => {
    if (catalog.length === 0) return;
    setSelected((current) => {
      return current.map((item) => ({
        ...item,
        name: catalog.find(({ key }) => key === item.key)?.name ?? item.name,
      }));
    });
  }, [catalog]);
  const presets = partyPresetCatalog.catalog.presets;
  const primary = useMemo<PresetSelection>(() => ({ presetMode: 'PRIMARY', partyPresetId: null }), []);
  const activePreset = selected.find(({ key }) => key === activePresetKey)?.preset ?? null;
  const activePresetName = selected.find(({ key }) => key === activePresetKey)?.name ?? '';

  function toggle(target: AvailableTarget) {
    const key = target.key;
    setSelected((current) => current.some((item) => item.key === key)
      ? current.filter((item) => item.key !== key)
      : [...current, { key, name: target.name, preset: primary }]);
  }
  function setTargetPreset(key: string, preset: PresetSelection) {
    setSelected((current) => current.map((item) => item.key === key ? { ...item, preset } : item));
  }
  async function save() {
    if (entry.type === 'FISHING') return onSave({ enabled, maps: selected.map((item, executionOrder) => ({
      categoryId: 'battle_map', mapCode: item.key, executionOrder, ...item.preset,
    })) });
    if (entry.type === 'UNION') return onSave({ enabled, maps: selected.map((item, executionOrder) => ({
      categoryId: 'union', mapCode: item.key, executionOrder, ...item.preset,
    })) });
    return onSave({ enabled, targets: selected.map((item, executionOrder) => ({
      raidId: item.key, displayName: item.name, executionOrder, ...item.preset,
    })) });
  }

  return <NestableScrollContainer contentContainerStyle={styles.container}>
    <View style={styles.header}>
      <Pressable accessibilityLabel="자동화 설정으로" accessibilityRole="button" onPress={onBack} style={styles.icon}><ArrowLeft color={theme.colors.text} size={20} /></Pressable>
      <View style={styles.copy}><Text style={styles.title}>{AUTOMATION_TYPE_METADATA[entry.type].label} 자동화</Text><Text style={styles.help}>{description(entry.type)}</Text></View>
    </View>
    <View style={styles.card}><Text style={styles.label}>자동화 사용</Text><Switch accessibilityLabel="자동화 사용" value={enabled} onValueChange={setEnabled} /></View>
    {mutationMessage ? <Text style={styles.warning}>{mutationMessage}</Text> : null}
    <>
      <Text style={styles.section}>{entry.type === 'FISHING' ? '선택한 낚시 전투 맵' : '선택한 대상 · 위에서부터 순환'}</Text>
      {selected.length === 0 ? <Text style={styles.muted}>대상을 하나 이상 선택해 주세요.</Text> : selected.map((item, index) => <View key={item.key} style={styles.target}>
        <Text style={styles.targetName}>{index + 1}. {item.name}</Text>
        <PresetTrigger name={item.name} value={item.preset} presets={presets} onPress={() => setActivePresetKey(item.key)} />
      </View>)}
      <Text style={styles.section}>{entry.type === 'FISHING' ? '관측된 낚시 전투 맵' : '선택 가능 목록'}</Text>
      {loading ? <ActivityIndicator color={theme.colors.accentGreen} /> : null}
      {error ? <Text style={styles.warning}>{error}</Text> : null}
      {catalog.map((target) => <Pressable key={target.key} accessibilityLabel={`${target.name} ${entry.type === 'RAID' ? '레이드 ' : ''}${selected.some((item) => item.key === target.key) ? '선택됨' : '추가'}`} accessibilityRole="checkbox" accessibilityState={{ checked: selected.some((item) => item.key === target.key) }} onPress={() => toggle(target)} style={styles.catalogRow}>
        <Text style={styles.targetName}>{target.name}</Text><Text style={styles.state}>{selected.some((item) => item.key === target.key) ? '선택됨' : '추가'}</Text>
      </Pressable>)}
    </>
    <BattleMapPresetPickerModal
      catalog={partyPresetCatalog.catalog}
      disabled={saving}
      mapName={activePresetName}
      onClose={() => setActivePresetKey(null)}
      onSelect={(presetId) => {
        const preset: PresetSelection = presetId == null
          ? { presetMode: 'PRIMARY', partyPresetId: null }
          : { presetMode: 'EXPLICIT', partyPresetId: presetId };
        if (activePresetKey != null) setTargetPreset(activePresetKey, preset);
        setActivePresetKey(null);
      }}
      selectedPresetId={activePreset?.partyPresetId ?? null}
      selectedPresetMode={activePreset?.presetMode ?? 'PRIMARY'}
      visible={activePreset != null}
    />
    <Pressable accessibilityLabel="자동화 저장" accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => { void save(); }} style={styles.save}>
      <Save color={theme.colors.buttonText} size={18} /><Text style={styles.saveText}>{saving ? '저장 중' : '저장'}</Text>
    </Pressable>
  </NestableScrollContainer>;
}

function PresetTrigger({ name, value, presets, onPress }: { name: string; value: PresetSelection; presets: Parameters<typeof formatAutomationPresetSelection>[1]; onPress: () => void }) {
  return <Pressable accessibilityLabel={`${name} 프리셋 선택 열기`} accessibilityRole="button" accessibilityValue={{ text: formatAutomationPresetSelection(value, presets) }} onPress={onPress} style={styles.presetTrigger}>
    <Text style={styles.presetTriggerText}>{formatAutomationPresetSelection(value, presets)}</Text>
  </Pressable>;
}
function description(type: TypedAutomationEntryResponse['type']) {
  if (type === 'FISHING') return '시작과 잡기를 반복하고 전투가 생기면 선택 프리셋으로 처리합니다.';
  if (type === 'UNION') return '공유 쿨다운이 끝날 때마다 선택 맵을 순서대로 한 번 전투합니다.';
  return '등록부터 시작·누적 전투·보상까지 진행하며 등록 후 사이클은 끝까지 수행합니다.';
}
function isFishingBattleMap(map: BattleMapResponse): boolean {
  return map.groupName?.trim().startsWith('낚시') === true
    || map.name.trim().toLocaleLowerCase().startsWith('fishing-');
}
const styles = StyleSheet.create({
  container: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }, header: { alignItems: 'center', flexDirection: 'row', gap: 8 }, icon: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 }, copy: { flex: 1 }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, help: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 3 }, card: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: theme.spacing.md }, label: { color: theme.colors.text, fontWeight: '800' }, section: { color: theme.colors.text, fontSize: 15, fontWeight: '900' }, muted: { color: theme.colors.textMuted, fontSize: 12 }, warning: { color: theme.colors.accentAmber, fontSize: 12 }, target: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, gap: 8, padding: theme.spacing.md }, targetName: { color: theme.colors.text, flex: 1, fontSize: 13, fontWeight: '800' }, catalogRow: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 48, paddingHorizontal: theme.spacing.sm }, state: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' }, presetBox: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, gap: 10, padding: theme.spacing.md }, presetTrigger: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, paddingHorizontal: 12, paddingVertical: 11 }, presetTriggerText: { color: theme.colors.text, fontSize: 13, fontWeight: '800' }, save: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 50 }, saveText: { color: theme.colors.buttonText, fontSize: 14, fontWeight: '900' },
});
