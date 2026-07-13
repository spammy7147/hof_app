import {
  ChevronDown,
  ChevronRight,
  Compass,
  Folder,
  FolderOpen,
  LucideIcon,
  Map,
  Shield,
  ShipWheel,
  Swords,
  Trophy,
} from 'lucide-react-native';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  type BattlePartyMember,
  toRunBattleRequest,
} from '../domain/battleParty';
import { orderBattleCategories } from '../domain/battleCategories';
import {
  buildBattleMapStateKey,
  formatBattleMapMeta,
  getAutomationMapSkipReason,
  groupBattleMaps,
  type BattleMapGroup,
} from '../domain/battleMaps';
import { getBattleResultRounds } from '../domain/battleResults';
import { BattleRunPanel } from '../features/battle/components/BattleRunPanel';
import { theme } from '../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  BattleResultResponse,
  HofCharacter,
  RunBattleRequest,
} from '../types/api';
import { PrimaryButton } from '../components/PrimaryButton';

type BattleTabScreenProps = {
  authenticated: boolean;
  categories: BattleCategoryResponse[];
  isLoading: boolean;
  errorMessage: string | null;
  characters: HofCharacter[];
  onLoadCategories: () => void;
  onLoadMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onRunBattle: (request: RunBattleRequest) => Promise<BattleResultResponse>;
};

const categoryIcons: Record<string, LucideIcon> = {
  battle_map: Swords,
  adventure_map: Map,
  union: Shield,
  scenario_ocean: ShipWheel,
  raid: Trophy,
};

type BattleTreeRow =
  | {
    type: 'category';
    key: string;
    category: BattleCategoryResponse;
    expanded: boolean;
    mapCount: number | null;
  }
  | {
    type: 'state';
    key: string;
    category: BattleCategoryResponse;
    state: 'loading' | 'error' | 'empty';
    errorMessage: string | null;
  }
  | {
    type: 'group';
    key: string;
    group: BattleMapGroup;
    expanded: boolean;
  }
  | {
    type: 'map';
    key: string;
    map: BattleMapResponse;
  };

/**
 * 전투 탭 화면이다.
 *
 * 카테고리 > 그룹 > 맵 트리를 보여주고, 선택한 맵에서 5인 파티/패턴을 골라 1회 또는 3회 전투를 실행한다.
 */
export function BattleTabScreen({
  authenticated,
  categories,
  isLoading,
  errorMessage,
  characters,
  onLoadCategories,
  onLoadMaps,
  onRunBattle,
}: BattleTabScreenProps) {
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [mapsByCategory, setMapsByCategory] = useState<Record<string, BattleMapResponse[]>>({});
  const [loadingCategoryId, setLoadingCategoryId] = useState<string | null>(null);
  const [mapErrorsByCategory, setMapErrorsByCategory] = useState<Record<string, string>>({});
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
  const [expandedMapKey, setExpandedMapKey] = useState<string | null>(null);
  const [runningMapKey, setRunningMapKey] = useState<string | null>(null);
  const [runErrorsByMapKey, setRunErrorsByMapKey] = useState<Record<string, string>>({});
  const [resultsByMapKey, setResultsByMapKey] = useState<Record<string, BattleResultResponse>>({});

  useEffect(() => {
    if (categories.length > 0 || isLoading || errorMessage) return;
    onLoadCategories();
  }, [categories.length, errorMessage, isLoading, onLoadCategories]);

  const orderedCategories = useMemo(() => orderBattleCategories(categories), [categories]);

  /**
   * 선택한 전투 카테고리의 하위 맵 목록을 서버에서 불러온다.
   *
   * 이미 한 번 불러온 카테고리는 기본적으로 캐시를 재사용하고, 재시도 버튼처럼 최신 목록이 필요할 때만 force로 다시 요청한다.
   */
  const loadMaps = useCallback(async (category: BattleCategoryResponse, force = false) => {
    if (!force && mapsByCategory[category.id]) return;

    if (!authenticated) {
      setMapErrorsByCategory((current) => ({
        ...current,
        [category.id]: '로그인 계정이 없습니다.',
      }));
      return;
    }

    setLoadingCategoryId(category.id);
    setMapErrorsByCategory((current) => {
      const next = { ...current };
      delete next[category.id];
      return next;
    });

    try {
      const loadedMaps = await onLoadMaps(category.id);
      setMapsByCategory((current) => ({
        ...current,
        [category.id]: loadedMaps,
      }));
    } catch (error) {
      setMapErrorsByCategory((current) => ({
        ...current,
        [category.id]: error instanceof Error ? error.message : '맵 목록을 불러오지 못했습니다.',
      }));
    } finally {
      setLoadingCategoryId((current) => (current === category.id ? null : current));
    }
  }, [authenticated, mapsByCategory, onLoadMaps]);

  /**
   * 카테고리 카드를 열고 닫는다.
   *
   * 새 카테고리를 열 때는 이전 그룹/맵 확장 상태를 초기화한 뒤 해당 카테고리의 맵 목록을 준비한다.
   */
  const toggleCategory = useCallback((category: BattleCategoryResponse) => {
    if (expandedCategoryId === category.id) {
      setExpandedCategoryId(null);
      setExpandedGroupKeys([]);
      return;
    }

    setExpandedCategoryId(category.id);
    setExpandedGroupKeys([]);
    setExpandedMapKey(null);
    void loadMaps(category);
  }, [expandedCategoryId, loadMaps]);

  /**
   * 카테고리 안의 맵 그룹을 열고 닫는다.
   *
   * 여러 그룹을 동시에 펼칠 수 있도록 열린 groupKey 목록을 배열로 관리한다.
   */
  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedGroupKeys((current) => (
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
    ));
  }, []);

  /**
   * 개별 맵을 열고 닫는다.
   *
   * 맵이 열리면 파티 선택기와 전투 실행 버튼이 함께 표시된다.
   */
  const toggleMap = useCallback((map: BattleMapResponse) => {
    const mapKey = buildBattleMapStateKey(map);
    setExpandedMapKey((current) => (current === mapKey ? null : mapKey));
  }, []);

  /**
   * 전투 성공 직후 키/도전/승리 제한을 먼저 화면에서 줄이고, 서버 재조회로 실제 HOF 상태를 다시 맞춘다.
   */
  const refreshMapsAfterBattle = useCallback((
    map: BattleMapResponse,
    battleCount: 1 | 3,
    result: BattleResultResponse,
  ) => {
    const victoryCount = getBattleResultRounds(result)
      .filter((round) => round.outcome === 'VICTORY')
      .length;

    setMapsByCategory((current) => ({
      ...current,
      [map.categoryId]: (current[map.categoryId] ?? []).map((currentMap) => {
        if (currentMap.mapCode !== map.mapCode) return currentMap;

        return {
          ...currentMap,
          availableCount: currentMap.availableCount == null
            ? null
            : Math.max(0, currentMap.availableCount - battleCount),
          attemptCount: currentMap.attemptCount == null
            ? null
            : Math.max(0, currentMap.attemptCount - battleCount),
          winCount: currentMap.winCount == null
            ? null
            : Math.max(0, currentMap.winCount - victoryCount),
          keyCount: currentMap.keyCount == null
            ? null
            : Math.max(0, currentMap.keyCount - battleCount),
        };
      }),
    }));

    void onLoadMaps(map.categoryId)
      .then((loadedMaps) => {
        setMapsByCategory((current) => ({
          ...current,
          [map.categoryId]: loadedMaps,
        }));
      })
      .catch(() => {
        // 전투 결과는 이미 반영됐으므로, 맵 상태 보정 실패는 다음 목록 새로고침에서 다시 맞춘다.
      });
  }, [onLoadMaps]);

  /**
   * 현재 화면에서 선택한 파티/패턴을 백엔드 전투 요청 형식으로 변환해 전투를 실행한다.
   *
   * 실행 중인 맵, 맵별 오류, 맵별 최신 결과를 따로 저장해서 여러 맵을 오가도 마지막 결과를 유지한다.
   */
  const runBattle = useCallback(async (
    map: BattleMapResponse,
    party: BattlePartyMember[],
    battleCount: 1 | 3,
  ) => {
    const mapKey = buildBattleMapStateKey(map);
    if (map.mapCode == null || !map.resolved) {
      setRunErrorsByMapKey((current) => ({
        ...current,
        [mapKey]: '맵 코드 확인 대기',
      }));
      return;
    }

    if (!authenticated) {
      setRunErrorsByMapKey((current) => ({
        ...current,
        [mapKey]: '로그인 계정이 없습니다.',
      }));
      return;
    }

    setRunningMapKey(mapKey);
    setRunErrorsByMapKey((current) => {
      const next = { ...current };
      delete next[mapKey];
      return next;
    });

    try {
      const request = toRunBattleRequest({
        categoryId: map.categoryId,
        mapCode: map.mapCode,
        party,
        characters,
        battleCount,
      });
      const result = await onRunBattle({
        ...request,
      });
      setResultsByMapKey((current) => ({
        ...current,
        [mapKey]: result,
      }));
      refreshMapsAfterBattle(map, battleCount, result);
    } catch (error) {
      setRunErrorsByMapKey((current) => ({
        ...current,
        [mapKey]: error instanceof Error ? error.message : '전투를 진행하지 못했습니다.',
      }));
    } finally {
      setRunningMapKey((current) => (current === mapKey ? null : current));
    }
  }, [authenticated, characters, onRunBattle, refreshMapsAfterBattle]);

  /**
   * FlatList가 바로 그릴 수 있도록 카테고리/상태/그룹/맵을 하나의 row 배열로 평탄화한다.
   *
   * 트리 UI처럼 보이지만 실제 렌더링은 긴 목록 하나로 처리하는 구조다.
   */
  const treeRows = useMemo<BattleTreeRow[]>(() => {
    const expandedGroupKeySet = new Set(expandedGroupKeys);
    const rows: BattleTreeRow[] = [];

    for (const category of orderedCategories) {
      const categoryExpanded = category.id === expandedCategoryId;
      const maps = mapsByCategory[category.id] ?? [];

      rows.push({
        type: 'category',
        key: `category:${category.id}`,
        category,
        expanded: categoryExpanded,
        mapCount: mapsByCategory[category.id]?.length ?? null,
      });

      if (!categoryExpanded) continue;

      const errorMessage = mapErrorsByCategory[category.id] ?? null;
      if (loadingCategoryId === category.id) {
        rows.push({
          type: 'state',
          key: `state:${category.id}:loading`,
          category,
          state: 'loading',
          errorMessage: null,
        });
        continue;
      }

      if (errorMessage) {
        rows.push({
          type: 'state',
          key: `state:${category.id}:error`,
          category,
          state: 'error',
          errorMessage,
        });
        continue;
      }

      const groups = groupBattleMaps(maps);
      if (groups.length === 0) {
        rows.push({
          type: 'state',
          key: `state:${category.id}:empty`,
          category,
          state: 'empty',
          errorMessage: null,
        });
        continue;
      }

      for (const group of groups) {
        const groupExpanded = expandedGroupKeySet.has(group.key);
        rows.push({
          type: 'group',
          key: `group:${group.key}`,
          group,
          expanded: groupExpanded,
        });

        if (!groupExpanded) continue;

        for (const map of group.maps) {
          rows.push({
            type: 'map',
            key: `map:${buildBattleMapStateKey(map)}`,
            map,
          });
        }
      }
    }

    return rows;
  }, [
    expandedCategoryId,
    expandedGroupKeys,
    loadingCategoryId,
    mapErrorsByCategory,
    mapsByCategory,
    orderedCategories,
  ]);
  const ListHeaderComponent = useMemo(() => (
    <View style={styles.headerStack}>
      <View style={styles.header}>
        <Text style={styles.title}>전투</Text>
        <Text style={styles.meta}>{orderedCategories.length}개 분류</Text>
      </View>

      {isLoading && orderedCategories.length === 0 ? (
        <View style={styles.statePanel}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.stateText}>전투 목록 확인 중</Text>
        </View>
      ) : null}

      {errorMessage != null && errorMessage.length > 0 && orderedCategories.length === 0 ? (
        <View style={styles.statePanel}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <PrimaryButton label="다시 시도" variant="secondary" onPress={onLoadCategories} />
        </View>
      ) : null}
    </View>
  ), [errorMessage, isLoading, onLoadCategories, orderedCategories.length]);
  /**
   * treeRows의 row 타입에 맞는 화면 조각을 선택한다.
   *
   * 카테고리, 로딩/오류 상태, 맵 그룹, 개별 맵은 서로 필요한 props가 달라서 switch로 분기한다.
   */
  const renderItem = useCallback(({ item }: { item: BattleTreeRow }) => {
    switch (item.type) {
      case 'category':
        return (
          <BattleCategoryCard
            expanded={item.expanded}
            category={item.category}
            mapCount={item.mapCount}
            onPress={() => toggleCategory(item.category)}
          />
        );
      case 'state':
        return (
          <View style={styles.treeBranch}>
            <BattleCategoryStatePanel
              category={item.category}
              errorMessage={item.errorMessage}
              state={item.state}
              onRetry={() => loadMaps(item.category, true)}
            />
          </View>
        );
      case 'group':
        return (
          <View style={styles.treeBranch}>
            <BattleMapGroupRow
              expanded={item.expanded}
              group={item.group}
              onPress={() => toggleGroup(item.group.key)}
            />
          </View>
        );
      case 'map':
        return (
          <View style={styles.mapTreeBranch}>
            <BattleMapRow
              map={item.map}
              characters={characters}
              expanded={expandedMapKey === buildBattleMapStateKey(item.map)}
              isRunning={runningMapKey === buildBattleMapStateKey(item.map)}
              result={resultsByMapKey[buildBattleMapStateKey(item.map)] ?? null}
              errorMessage={runErrorsByMapKey[buildBattleMapStateKey(item.map)] ?? null}
              onPress={() => toggleMap(item.map)}
              onRunBattle={(party, battleCount) => runBattle(item.map, party, battleCount)}
            />
          </View>
        );
    }
  }, [
    authenticated,
    characters,
    expandedMapKey,
    loadMaps,
    resultsByMapKey,
    runBattle,
    runErrorsByMapKey,
    runningMapKey,
    toggleCategory,
    toggleGroup,
    toggleMap,
  ]);

  return (
    <FlatList
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      data={treeRows}
      ItemSeparatorComponent={TreeRowSeparator}
      keyExtractor={(item) => item.key}
      ListHeaderComponent={ListHeaderComponent}
      renderItem={renderItem}
      style={styles.list}
    />
  );
}

type BattleCategoryCardProps = {
  category: BattleCategoryResponse;
  expanded: boolean;
  mapCount: number | null;
  onPress: () => void;
};

/**
 * 전투/모험 같은 최상위 전투 카테고리 카드다.
 *
 * 비활성 카테고리는 누를 수 없게 하고, 이미 로드된 맵 개수가 있으면 우측 배지에 표시한다.
 */
function BattleCategoryCard({ expanded, category, mapCount, onPress }: BattleCategoryCardProps) {
  const Icon = categoryIcons[category.id] ?? Compass;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded, disabled: !category.enabled }}
      disabled={!category.enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        expanded && styles.activeCard,
        !category.enabled && styles.disabledCard,
        pressed && styles.pressedCard,
      ]}
    >
      <View style={styles.iconBox}>
        <Icon color={category.enabled ? theme.colors.accentAmber : theme.colors.textMuted} size={22} />
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {category.label}
        </Text>
        <Text style={styles.cardDescription} numberOfLines={1}>
          {category.description}
        </Text>
      </View>
      <Text style={[styles.badge, !category.enabled && styles.disabledBadge]}>
        {category.enabled ? (mapCount == null ? '열기' : `${mapCount}개`) : '비활성'}
      </Text>
      <Chevron color={theme.colors.textMuted} size={16} />
    </Pressable>
  );
}

type BattleCategoryStatePanelProps = {
  category: BattleCategoryResponse;
  errorMessage: string | null;
  onRetry: () => void;
  state: 'loading' | 'error' | 'empty';
};

/**
 * 카테고리 내부 맵 목록의 로딩, 오류, 빈 상태를 한 곳에서 표시한다.
 *
 * 오류 상태에서는 다시 시도 버튼을 노출해서 같은 카테고리만 재조회할 수 있게 한다.
 */
function BattleCategoryStatePanel({
  category,
  errorMessage,
  onRetry,
  state,
}: BattleCategoryStatePanelProps) {
  if (state === 'loading') {
    return (
      <View style={styles.treeStatePanel}>
        <ActivityIndicator color={theme.colors.accentGreen} />
        <Text style={styles.stateText}>맵 목록 확인 중</Text>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={styles.treeStatePanel}>
        <Text style={styles.errorText}>{errorMessage ?? '맵 목록을 불러오지 못했습니다.'}</Text>
        <PrimaryButton label="다시 시도" variant="secondary" onPress={onRetry} />
      </View>
    );
  }

  return (
    <View style={styles.treeStatePanel}>
      <Text style={styles.stateText}>{category.label} 맵 없음</Text>
    </View>
  );
}

type BattleMapGroupRowProps = {
  group: BattleMapGroup;
  expanded: boolean;
  onPress: () => void;
};

/**
 * 같은 지역/레벨대에 속한 맵들을 묶어 보여주는 그룹 row다.
 *
 * 그룹을 눌러 실제 전투 맵 목록을 펼치거나 접는다.
 */
function BattleMapGroupRow({ expanded, group, onPress }: BattleMapGroupRowProps) {
  const FolderIcon = expanded ? FolderOpen : Folder;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const groupMeta = [
    group.recommendedLevel ? `Lv ${group.recommendedLevel}` : null,
    `${group.maps.length}개`,
  ].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.groupRow,
        expanded && styles.activeGroupRow,
        pressed && styles.pressedCard,
      ]}
    >
      <View style={styles.groupIconBox}>
        <FolderIcon color={theme.colors.accentGreen} size={18} />
      </View>
      <View style={styles.groupText}>
        <Text style={styles.groupName} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={styles.groupMetaText} numberOfLines={1}>
          {groupMeta}
        </Text>
      </View>
      <Chevron color={theme.colors.textMuted} size={15} />
    </Pressable>
  );
}

type BattleMapRowProps = {
  map: BattleMapResponse;
  characters: HofCharacter[];
  expanded: boolean;
  isRunning: boolean;
  result: BattleResultResponse | null;
  errorMessage: string | null;
  onPress: () => void;
  onRunBattle: (party: BattlePartyMember[], battleCount: 1 | 3) => void;
};

/**
 * 전투 가능한 개별 맵 row다.
 *
 * 펼쳐진 상태에서는 BattleRunPanel을 렌더링해서 파티 설정과 1회/3회 전투 실행을 연결한다.
 */
function BattleMapRow({
  map,
  characters,
  expanded,
  isRunning,
  result,
  errorMessage,
  onPress,
  onRunBattle,
}: BattleMapRowProps) {
  const unresolved = map.mapCode == null || !map.resolved;
  const mapUnavailable = !map.enabled || unresolved;
  const unresolvedReason = unresolved ? getAutomationMapSkipReason(map) : null;
  const mapMeta = [formatBattleMapMeta(map), unresolvedReason].filter(Boolean).join(' · ');

  return (
    <View style={styles.mapItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: mapUnavailable }}
        disabled={mapUnavailable}
        onPress={onPress}
        style={({ pressed }) => [
          styles.mapRow,
          expanded && styles.activeMapRow,
          mapUnavailable && styles.disabledCard,
          pressed && styles.pressedCard,
        ]}
      >
        <View style={styles.mapRowText}>
          <Text style={styles.mapName} numberOfLines={2}>
            {map.name}
          </Text>
          {mapMeta.length > 0 ? (
            <Text style={styles.mapMeta} numberOfLines={1}>
              {mapMeta}
            </Text>
          ) : null}
        </View>
        {expanded ? (
          <ChevronDown color={theme.colors.textMuted} size={15} />
        ) : (
          <ChevronRight color={theme.colors.textMuted} size={15} />
        )}
      </Pressable>
      {expanded ? (
        <BattleRunPanel
          characters={characters}
          errorMessage={errorMessage}
          isRunning={isRunning}
          result={result}
          onRunBattle={onRunBattle}
        />
      ) : null}
    </View>
  );
}

/**
 * FlatList row 사이의 간격을 담당하는 작은 separator 컴포넌트다.
 */
function TreeRowSeparator() {
  return <View style={styles.treeRowSeparator} />;
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  headerStack: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  treeRowSeparator: {
    height: 6,
  },
  header: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  meta: {
    color: theme.colors.accentGreen,
    fontSize: 14,
    fontWeight: '800',
  },
  statePanel: {
    minHeight: 126,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  stateText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  treeList: {
    gap: theme.spacing.sm,
  },
  treeBranch: {
    marginLeft: 18,
    gap: theme.spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingLeft: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  treeStatePanel: {
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  groupList: {
    gap: theme.spacing.sm,
  },
  mapTreeBranch: {
    marginLeft: 17,
    gap: theme.spacing.xs,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    paddingLeft: theme.spacing.sm,
    paddingBottom: 0,
  },
  mapItem: {
    gap: theme.spacing.xs,
  },
  mapSection: {
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
  },
  mapHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  mapTitle: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  mapMeta: {
    color: theme.colors.accentGreen,
    fontSize: 13,
    fontWeight: '800',
  },
  mapList: {
    gap: theme.spacing.sm,
  },
  card: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  activeCard: {
    borderColor: theme.colors.accentGreen,
  },
  disabledCard: {
    opacity: 0.58,
  },
  pressedCard: {
    opacity: 0.78,
  },
  iconBox: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
  },
  cardText: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  cardDescription: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  badge: {
    minWidth: 54,
    color: theme.colors.buttonText,
    overflow: 'hidden',
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.accentAmber,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  disabledBadge: {
    color: theme.colors.textMuted,
    backgroundColor: theme.colors.surfaceAlt,
  },
  groupRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  activeGroupRow: {
    borderColor: theme.colors.accentGreen,
  },
  groupIconBox: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  groupText: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  groupName: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  groupMetaText: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  mapRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 2,
  },
  activeMapRow: {
    borderColor: theme.colors.accentBlue,
  },
  mapRowText: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  mapName: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
});
