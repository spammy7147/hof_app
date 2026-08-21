import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ArrowLeft, ChevronRight, Save } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';

import type { PartyPresetCatalogResource } from '../../../domain/partyPresetCatalogModule';
import { formatAutomationPresetSelection } from '../../../domain/partyPresets';
import { AUTOMATION_TYPE_METADATA } from '../../../domain/typedAutomation';
import { resolveUnionMapDisplayName } from '../../../domain/unionAutomation';
import { theme } from '../../../styles/theme';
import type {
  BattleMapResponse, PresetSelection, RaidPubResponse, TypedAutomationEntryResponse,
  UpdateFishingAutomationRequest, UpdateRaidAutomationRequest, UpdateUnionAutomationRequest,
} from '../../../types/api';
import { BattleMapPresetPickerModal } from './BattleMapPresetPickerModal';
import { AutomationMapEditorTabs, type AutomationMapEditorTab } from './AutomationMapEditorTabs';
import { AutomationMapOrderList } from './AutomationMapOrderList';
import { BattleMapCatalogMapRow } from './BattleMapCatalogRows';

type SaveRequest = UpdateFishingAutomationRequest | UpdateRaidAutomationRequest | UpdateUnionAutomationRequest;
type Props = {
  entry: TypedAutomationEntryResponse; saving: boolean; mutationMessage: string | null;
  onBack: () => void; onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onLoadRaidTargets: () => Promise<RaidPubResponse>;
  partyPresetCatalog: PartyPresetCatalogResource; onSave: (request: SaveRequest) => Promise<boolean>;
};
type SelectedTarget = { key: string; name: string; preset: PresetSelection };
type AvailableTarget = { key: string; name: string; map?: BattleMapResponse };

export function NewAutomationEditor({ entry, saving, mutationMessage, onBack, onLoadBattleMaps, onLoadRaidTargets, partyPresetCatalog, onSave }: Props) {
  const [enabled, setEnabled] = useState(entry.enabled);
  const [catalog, setCatalog] = useState<AvailableTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AutomationMapEditorTab>('SELECTED');
  const [query, setQuery] = useState('');
  const [activePresetKey, setActivePresetKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedTarget[]>(() => {
    if (entry.type === 'FISHING') return (entry.fishingMaps ?? []).map((item) => ({ key: item.mapCode, name: item.displayName ?? item.mapCode, preset: item }));
    if (entry.type === 'UNION') return (entry.unionMaps ?? []).map((item) => ({
      key: item.mapCode,
      name: resolveUnionMapDisplayName(item.mapCode, item.displayName),
      preset: item,
    }));
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
        .filter((map): map is BattleMapResponse & { mapCode: string } => Boolean(map.mapCode && map.resolved))
        .map((map) => {
          const name = resolveUnionMapDisplayName(map.mapCode, map.name);
          return { key: map.mapCode, name, map: { ...map, name } };
        }))
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
  const filteredCatalog = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return catalog;
    return catalog.filter(({ key, name }) => `${name} ${key}`.toLocaleLowerCase().includes(normalized));
  }, [catalog, query]);

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
      ...item.preset, categoryId: 'battle_map', mapCode: item.key, executionOrder,
    })) });
    if (entry.type === 'UNION') return onSave({ enabled, maps: selected.map((item, executionOrder) => ({
      ...item.preset, categoryId: 'union', mapCode: item.key, executionOrder,
    })) });
    return onSave({ enabled, targets: selected.map((item, executionOrder) => ({
      ...item.preset, raidId: item.key, displayName: item.name, executionOrder,
    })) });
  }

  function moveSelected(key: string, offset: -1 | 1) {
    setSelected((current) => {
      const from = current.findIndex((item) => item.key === key);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function reorderSelected(orderedKeys: string[]) {
    setSelected((current) => {
      if (orderedKeys.length !== current.length || new Set(orderedKeys).size !== current.length) return current;
      const byKey = new Map(current.map((item) => [item.key, item]));
      const next = orderedKeys.map((key) => byKey.get(key));
      return next.some((item) => item == null) ? current : next as SelectedTarget[];
    });
  }

  if (entry.type === 'UNION' || entry.type === 'RAID') {
    const isUnion = entry.type === 'UNION';
    const typeLabel = isUnion ? '유니온' : '레이드';
    const controlsDisabled = saving;
    return <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel={`${typeLabel} 자동화 뒤로`} accessibilityRole="button" disabled={controlsDisabled} onPress={onBack} style={styles.icon}><ArrowLeft color={theme.colors.text} size={21} /></Pressable>
        <View style={styles.copy}><Text style={styles.title}>{typeLabel} 자동화</Text><Text style={styles.help}>{description(entry.type)}</Text></View>
        <Switch accessibilityLabel={`${typeLabel} 자동화 사용`} disabled={controlsDisabled} value={enabled} onValueChange={setEnabled} />
      </View>
      {mutationMessage ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.warning}>{mutationMessage}</Text> : null}
      <AutomationMapEditorTabs activeTab={activeTab} onChange={setActiveTab} selectedCount={selected.length} />
      {activeTab === 'CATALOG' ? <TextInput
        accessibilityLabel={`${typeLabel} 맵 검색`}
        editable={!controlsDisabled}
        onChangeText={setQuery}
        placeholder={isUnion ? '추가할 유니온 맵 이름 또는 코드 검색' : '추가할 레이드 이름 검색'}
        placeholderTextColor={theme.colors.textMuted}
        style={styles.search}
        value={query}
      /> : null}
      <NestableScrollContainer contentContainerStyle={styles.unionContent} style={styles.scroller}>
        {activeTab === 'SELECTED' ? <>
          <Text style={styles.section}>선택한 맵 · 실행 순서</Text>
          {selected.length === 0 ? <Text style={styles.muted}>맵 추가 탭에서 실행할 맵을 추가해 주세요.</Text> : <AutomationMapOrderList
            data={selected}
            disabled={controlsDisabled}
            getId={(item) => item.key}
            getLabel={(item) => item.name}
            nested
            onDelete={(key) => setSelected((current) => current.filter((item) => item.key !== key))}
            onMove={moveSelected}
            onReorder={reorderSelected}
            renderContent={(item, { disabled }) => <>
              <Text ellipsizeMode="tail" numberOfLines={2} style={styles.mapName}>{item.name}</Text>
              <Text style={styles.mapMeta}>{isUnion ? '유니온 맵 · 공유 쿨다운마다 1회 전투' : '레이드 · 완료 후 다음 대상으로 순환'}</Text>
              <Pressable
                accessibilityLabel={`${item.name} 프리셋 선택 열기`}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => setActivePresetKey(item.key)}
                style={[styles.choice, disabled && styles.disabled]}
              >
                <Text style={styles.choiceLabel}>프리셋</Text>
                <Text numberOfLines={1} style={styles.choiceText}>{formatAutomationPresetSelection(item.preset, presets)}</Text>
                <ChevronRight color={theme.colors.textMuted} size={16} />
              </Pressable>
            </>}
          />}
        </> : <>
          <Text style={styles.section}>맵 찾기</Text>
          {loading ? <View style={styles.loadingRow}><ActivityIndicator color={theme.colors.accentGreen} /><Text style={styles.muted}>{typeLabel} 목록 불러오는 중</Text></View> : null}
          {error ? <Text style={styles.warning}>{error}</Text> : null}
          {!loading && !error && filteredCatalog.length === 0 ? <Text style={styles.muted}>검색 가능한 {typeLabel} 대상이 없습니다.</Text> : null}
          {filteredCatalog.map((target) => {
            const targetSelected = selected.some((item) => item.key === target.key);
            return isUnion && target.map ? <BattleMapCatalogMapRow
              key={target.key}
              disabled={controlsDisabled}
              map={target.map}
              onPress={() => toggle(target)}
              selected={targetSelected}
            /> : <Pressable
              key={target.key}
              accessibilityLabel={`${target.name} 레이드 ${targetSelected ? '선택 해제' : '선택'}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: controlsDisabled, selected: targetSelected }}
              disabled={controlsDisabled}
              onPress={() => toggle(target)}
              style={[styles.catalogCard, targetSelected && styles.catalogCardSelected, controlsDisabled && styles.disabled]}
            >
              <Text numberOfLines={2} style={styles.mapName}>{target.name}</Text>
              {targetSelected ? <Text style={styles.selectedMeta}>선택한 레이드</Text> : null}
            </Pressable>;
          })}
        </>}
      </NestableScrollContainer>
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
      <View style={styles.footer}>
        <Pressable accessibilityLabel={`${typeLabel} 자동화 저장`} accessibilityRole="button" accessibilityState={{ busy: saving, disabled: saving }} disabled={saving} onPress={() => { void save(); }} style={[styles.save, saving && styles.disabled]}>
          {saving ? <ActivityIndicator color={theme.colors.buttonText} size="small" /> : <Save color={theme.colors.buttonText} size={18} />}<Text style={styles.saveText}>저장</Text>
        </Pressable>
      </View>
    </View>;
  }

  return <NestableScrollContainer contentContainerStyle={styles.container} style={styles.scroller}>
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
  return '등록부터 시작·누적 전투·보상 후 확인까지 진행합니다. 대기 중에는 다른 자동화가 계속됩니다. 진행 중 대상을 해제하면 수동 레이드로 인계합니다.';
}
function isFishingBattleMap(map: BattleMapResponse): boolean {
  return map.groupName?.trim().startsWith('낚시') === true
    || map.name.trim().toLocaleLowerCase().startsWith('fishing-');
}
const styles = StyleSheet.create({
  screen: { flex: 1, gap: theme.spacing.xs, padding: theme.spacing.lg }, scroller: { flex: 1 }, container: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }, unionContent: { gap: theme.spacing.sm, paddingBottom: theme.spacing.lg }, header: { alignItems: 'center', flexDirection: 'row', gap: 8 }, icon: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 }, copy: { flex: 1 }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, help: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 3 }, card: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: theme.spacing.md }, label: { color: theme.colors.text, fontWeight: '800' }, section: { color: theme.colors.text, fontSize: 15, fontWeight: '900' }, muted: { color: theme.colors.textMuted, fontSize: 12 }, warning: { color: theme.colors.accentAmber, fontSize: 12 }, target: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, gap: 8, padding: theme.spacing.md }, targetName: { color: theme.colors.text, flex: 1, fontSize: 13, fontWeight: '800' }, mapName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' }, mapMeta: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 }, catalogCard: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 4, minHeight: 48, justifyContent: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }, catalogCardSelected: { backgroundColor: 'rgba(124, 224, 181, 0.10)', borderColor: theme.colors.accentGreen, borderLeftWidth: 3 }, selectedMeta: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' }, catalogRow: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 48, paddingHorizontal: theme.spacing.sm }, state: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' }, presetBox: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, gap: 10, padding: theme.spacing.md }, presetTrigger: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, paddingHorizontal: 12, paddingVertical: 11 }, presetTriggerText: { color: theme.colors.text, fontSize: 13, fontWeight: '800' }, choice: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: 9, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, marginTop: 4, minHeight: 32, paddingHorizontal: theme.spacing.sm }, choiceLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '700' }, choiceText: { color: theme.colors.text, flex: 1, fontSize: 12, fontWeight: '800' }, search: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: theme.colors.text, minHeight: 46, paddingHorizontal: theme.spacing.md }, loadingRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 44 }, footer: { flexDirection: 'row', gap: theme.spacing.sm }, save: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 48 }, saveText: { color: theme.colors.buttonText, fontSize: 14, fontWeight: '900' }, disabled: { opacity: 0.45 },
});
