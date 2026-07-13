import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronRight } from 'lucide-react-native';

import { getPriorityQuestName, getUnifiedModuleCategoryIds } from '../../../domain/unifiedAutomation';
import { theme } from '../../../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  PartyPresetResponse,
  UnifiedAutomationMap,
  UnifiedAutomationSettingsRequest,
} from '../../../types/api';
import type { UnifiedSettingsRoute } from './UnifiedAutomationSettings';

type Props = {
  route: UnifiedSettingsRoute;
  settings: UnifiedAutomationSettingsRequest;
  categories: BattleCategoryResponse[];
  partyPresets: PartyPresetResponse[];
  onChange: (settings: UnifiedAutomationSettingsRequest) => void;
  onLoadMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
};

const EAST_MANSION_MAPS = [
  { label: '저택 동관(보쉬의 방)', value: 'Noble1021' },
  { label: '저택 동관(하인켈의 방)', value: 'Noble1022' },
  { label: '저택 동관(커티스의 방)', value: 'Noble1023' },
  { label: '저택 동관(복도)', value: 'Noble102' },
] as const;

const DETAIL_TITLES: Record<UnifiedSettingsRoute, string> = {
  keyQuest: '열쇠 퀘스트',
  time: 'Time 자동 소모',
  cooldownAdventure: '쿨다운 모험맵',
  dailyAdventure: '일일 제한 모험맵',
  union: '유니온',
  normalQuest: '일반 퀘스트',
};

export function getUnifiedDetailTitle(route: UnifiedSettingsRoute): string {
  return DETAIL_TITLES[route];
}

/** 설정 첫 화면에서 선택한 모듈 하나만 편집하는 세부 화면이다. */
export function UnifiedAutomationDetail(props: Props) {
  if (props.route === 'keyQuest') return <KeyQuestDetail {...props} />;
  if (props.route === 'time') return <TimeDetail {...props} />;
  if (props.route === 'normalQuest') return <NormalQuestDetail />;

  return (
    <MapModuleDetail
      route={props.route}
      categories={props.categories}
      maps={props.settings[props.route].maps}
      partyPresets={props.partyPresets}
      onChange={(maps) => props.onChange({
        ...props.settings,
        [props.route]: { ...props.settings[props.route], maps },
      })}
      onLoadMaps={props.onLoadMaps}
    />
  );
}

function KeyQuestDetail({ settings, partyPresets, onChange }: Props) {
  const eastQuest = settings.keyQuest.quests.find((quest) => quest.questId === '0563');
  const culvertQuest = settings.keyQuest.quests.find((quest) => quest.questId === '0351');
  const selectedEastCodes = eastQuest?.maps.map((map) => map.mapCode) ?? [];
  const culvertPresetId = culvertQuest?.maps[0]?.partyPresetId ?? null;

  function updateQuestMaps(questId: string, maps: UnifiedAutomationMap[]) {
    const existing = settings.keyQuest.quests.filter((quest) => quest.questId !== questId);
    const priority = ['0563', '0571', '0171', '0351'];
    const quests = [...existing, { questId, maps }].sort(
      (left, right) => priority.indexOf(left.questId) - priority.indexOf(right.questId),
    );
    onChange({ ...settings, keyQuest: { ...settings.keyQuest, quests } });
  }

  function toggleEastMap(value: string) {
    const selected = selectedEastCodes.includes(value)
      ? selectedEastCodes.filter((code) => code !== value)
      : [...selectedEastCodes, value];
    updateQuestMaps('0563', selected.map((mapCode, executionOrder) => ({
      categoryId: 'battle_map',
      mapCode,
      partyPresetId: null,
      executionOrder,
    })));
  }

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{getPriorityQuestName('0563')}</Text>
        <Text style={styles.help}>하나를 고르면 그 맵을 반복하고, 여러 맵을 고르면 열쇠가 균형을 이루도록 실행해요.</Text>
        <View style={styles.optionList}>
          {EAST_MANSION_MAPS.map((map) => (
            <SelectionRow
              key={map.value}
              label={map.label}
              selected={selectedEastCodes.includes(map.value)}
              onPress={() => toggleEastMap(map.value)}
            />
          ))}
        </View>
        <Text style={styles.hint}>저택 동관(복도)을 함께 선택하면 방 열쇠가 없을 때 복도로 자동 전환해요.</Text>
      </View>

      <QuestSummary title={getPriorityQuestName('0571')} detail="저택 서관 · 기본 퀘스트 파티 자동 적용" />
      <QuestSummary title={getPriorityQuestName('0171')} detail="퀘스트 상태를 확인한 뒤 필요한 설정을 안내해요" />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{getPriorityQuestName('0351')}</Text>
        <Text style={styles.help}>마을 지하 수로(입구)에서 사용할 파티 프리셋을 선택해 주세요.</Text>
        <PresetPicker
          selectedId={culvertPresetId}
          presets={partyPresets}
          onSelect={(partyPresetId) => updateQuestMaps('0351', [{
            categoryId: 'battle_map',
            mapCode: 'tnfh1',
            partyPresetId,
            executionOrder: 0,
          }])}
        />
      </View>
    </View>
  );
}

function TimeDetail({ settings, categories, partyPresets, onChange, onLoadMaps }: Props) {
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Time 기준</Text>
        <Text style={styles.help}>최대치 대비 이 비율을 넘으면 일반맵을 먼저 실행해요.</Text>
        <View style={styles.chipRow}>
          {[80, 85, 90, 95].map((threshold) => (
            <Pressable
              key={threshold}
              onPress={() => onChange({
                ...settings,
                time: { ...settings.time, thresholdPercent: threshold },
              })}
              style={[styles.chip, settings.time.thresholdPercent === threshold && styles.chipSelected]}
            >
              <Text style={[styles.chipText, settings.time.thresholdPercent === threshold && styles.chipTextSelected]}>{threshold}%</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <MapModuleDetail
        route="time"
        categories={categories}
        maps={settings.time.maps}
        partyPresets={partyPresets}
        onChange={(maps) => onChange({ ...settings, time: { ...settings.time, maps } })}
        onLoadMaps={onLoadMaps}
      />
    </View>
  );
}

function NormalQuestDetail() {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>일반 퀘스트 선택</Text>
      <Text style={styles.help}>퀘스트 페이지에서 수락 가능한 목록을 불러오는 기능과 함께 제공될 예정이에요. 우선 열쇠 퀘스트는 위 설정만으로 동작합니다.</Text>
    </View>
  );
}

type MapModuleDetailProps = {
  route: Exclude<UnifiedSettingsRoute, 'keyQuest' | 'normalQuest'>;
  categories: BattleCategoryResponse[];
  maps: UnifiedAutomationMap[];
  partyPresets: PartyPresetResponse[];
  onChange: (maps: UnifiedAutomationMap[]) => void;
  onLoadMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
};

function MapModuleDetail({ route, categories, maps, partyPresets, onChange, onLoadMaps }: MapModuleDetailProps) {
  const relevantCategoryIds = useMemo(() => getUnifiedModuleCategoryIds(route), [route]);
  const availableCategories = useMemo(
    () => categories.filter((category) => category.enabled && relevantCategoryIds.includes(category.id)),
    [categories, relevantCategoryIds],
  );
  const [categoryId, setCategoryId] = useState(availableCategories[0]?.id ?? '');
  const [catalog, setCatalog] = useState<BattleMapResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!categoryId && availableCategories[0]) setCategoryId(availableCategories[0].id);
  }, [availableCategories, categoryId]);

  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    onLoadMaps(categoryId)
      .then((loaded) => { if (!cancelled) setCatalog(loaded); })
      .catch(() => { if (!cancelled) setErrorMessage('맵 목록을 불러오지 못했어요.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categoryId, onLoadMaps]);

  function toggleMap(map: BattleMapResponse) {
    if (!map.mapCode || !map.resolved) return;
    const index = maps.findIndex((selected) => selected.categoryId === map.categoryId && selected.mapCode === map.mapCode);
    if (index >= 0) {
      onChange(maps.filter((_, mapIndex) => mapIndex !== index).map((selected, executionOrder) => ({ ...selected, executionOrder })));
      return;
    }
    onChange([...maps, {
      categoryId: map.categoryId,
      mapCode: map.mapCode,
      partyPresetId: null,
      executionOrder: maps.length,
    }]);
  }

  function assignPreset(map: BattleMapResponse, partyPresetId: number | null) {
    if (!map.mapCode) return;
    onChange(maps.map((selected) => (
      selected.categoryId === map.categoryId && selected.mapCode === map.mapCode
        ? { ...selected, partyPresetId }
        : selected
    )));
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{getUnifiedDetailTitle(route)} 맵</Text>
      <View style={styles.categoryRow}>
        {availableCategories.map((category) => (
          <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.categoryChip, categoryId === category.id && styles.categoryChipSelected]}>
            <Text style={[styles.categoryText, categoryId === category.id && styles.categoryTextSelected]}>{category.label}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? <ActivityIndicator color={theme.colors.accentGreen} /> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {!loading ? (
        <View style={styles.optionList}>
          {catalog.filter((map) => map.resolved && map.mapCode).map((map) => {
            const selected = maps.some((saved) => saved.categoryId === map.categoryId && saved.mapCode === map.mapCode);
            const saved = maps.find((item) => item.categoryId === map.categoryId && item.mapCode === map.mapCode);
            return (
              <View key={`${map.categoryId}:${map.name}`} style={styles.mapBlock}>
                <SelectionRow label={map.name} selected={selected} onPress={() => toggleMap(map)} />
                {selected ? (
                  <PresetPicker
                    selectedId={saved?.partyPresetId ?? null}
                    presets={partyPresets}
                    onSelect={(presetId) => assignPreset(map, presetId)}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function SelectionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.selectionRow, selected && styles.selectionRowSelected, pressed && styles.pressed]}>
      <View style={[styles.checkBox, selected && styles.checkBoxSelected]}>
        {selected ? <Check color={theme.colors.buttonText} size={14} strokeWidth={3} /> : null}
      </View>
      <Text style={styles.selectionLabel}>{label}</Text>
    </Pressable>
  );
}

function QuestSummary({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.help}>{detail}</Text>
    </View>
  );
}

function PresetPicker({ selectedId, presets, onSelect }: { selectedId: number | null; presets: PartyPresetResponse[]; onSelect: (presetId: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const selected = presets.find((preset) => preset.id === selectedId);
  return (
    <View style={styles.presetBox}>
      <Pressable onPress={() => setOpen((current) => !current)} style={styles.presetButton}>
        <Text style={styles.presetText}>{selected?.name ?? '파티 프리셋 선택'}</Text>
        {open ? <ChevronDown color={theme.colors.textMuted} size={16} /> : <ChevronRight color={theme.colors.textMuted} size={16} />}
      </Pressable>
      {open ? (
        <View style={styles.presetList}>
          {presets.map((preset) => (
            <Pressable key={preset.id} onPress={() => { onSelect(preset.id); setOpen(false); }} style={styles.presetOption}>
              <Text style={styles.presetText}>{preset.name}</Text>
            </Pressable>
          ))}
          {presets.length === 0 ? <Text style={styles.hint}>캐릭터 탭에서 프리셋을 먼저 만들어 주세요.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.md },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.md },
  cardTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  help: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },
  hint: { color: theme.colors.accentBlue, fontSize: 12, lineHeight: 18 },
  optionList: { gap: 7 },
  selectionRow: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 45, paddingHorizontal: 11 },
  selectionRowSelected: { borderColor: theme.colors.accentGreen },
  checkBox: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: 4, borderWidth: 1, height: 20, justifyContent: 'center', width: 20 },
  checkBoxSelected: { backgroundColor: theme.colors.accentGreen, borderColor: theme.colors.accentGreen },
  selectionLabel: { color: theme.colors.text, flex: 1, fontSize: 14, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipSelected: { backgroundColor: theme.colors.accentGreen, borderColor: theme.colors.accentGreen },
  chipText: { color: theme.colors.text, fontWeight: '700' },
  chipTextSelected: { color: theme.colors.buttonText },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  categoryChip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, paddingHorizontal: 10, paddingVertical: 7 },
  categoryChipSelected: { backgroundColor: theme.colors.accentGreen },
  categoryText: { color: theme.colors.textMuted, fontSize: 12 },
  categoryTextSelected: { color: theme.colors.buttonText, fontWeight: '800' },
  mapBlock: { gap: 5 },
  presetBox: { marginLeft: 30 },
  presetButton: { alignItems: 'center', backgroundColor: theme.colors.background, borderRadius: theme.radius.sm, flexDirection: 'row', minHeight: 38, paddingHorizontal: 10 },
  presetText: { color: theme.colors.text, flex: 1, fontSize: 13 },
  presetList: { backgroundColor: theme.colors.background, borderRadius: theme.radius.sm, gap: 2, marginTop: 3, padding: 5 },
  presetOption: { minHeight: 38, padding: 9 },
  error: { color: theme.colors.danger, fontSize: 13 },
  pressed: { opacity: 0.72 },
});
