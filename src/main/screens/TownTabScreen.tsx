import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type View as NativeView,
} from 'react-native';

import { getAccessibilityFocusTarget, focusAccessibilityTarget } from '../platform/accessibilityFocus';

import {
  DEFAULT_TOWN_CATEGORY_ID,
  getTownMenuById,
  searchTownMenus,
  type TownCategoryFilterId,
  type TownMenuId,
} from '../domain/townMenus';
import { TownCategoryChips } from '../features/town/components/TownCategoryChips';
import { TownDetailShell } from '../features/town/components/TownDetailShell';
import { TownMenuGrid } from '../features/town/components/TownMenuGrid';
import { FishingPanel } from '../features/town/panels/FishingPanel';
import { ShopPanel } from '../features/town/panels/ShopPanel';
import { AuctionPanel } from '../features/town/panels/AuctionPanel';
import { CardPanel } from '../features/town/panels/CardPanel';
import { RewardPanel } from '../features/town/panels/RewardPanel';
import { CraftingPanel } from '../features/town/panels/CraftingPanel';
import { AgencyPanel } from '../features/town/panels/AgencyPanel';
import { HomePanel } from '../features/town/panels/HomePanel';
import { ExchangePanel } from '../features/town/panels/ExchangePanel';
import { ColosseumPanel } from '../features/town/panels/ColosseumPanel';
import { RaidPanel } from '../features/town/panels/RaidPanel';
import { PantheonPanel } from '../features/town/panels/PantheonPanel';
import type { TownApi } from '../features/town/api/townApi';
import { TOWN_PANEL_REGISTRY } from '../features/town/townPanelRegistry';
import type { PartyPresetCatalogResource } from '../domain/partyPresetCatalogModule';
import type { BattleResultResponse, FishingBattleTarget, HofCharacter, RunBattleRequest } from '../types/api';
import { theme } from '../styles/theme';

export type TownTabScreenProps = {
  onCaptureListScroll?: () => void;
  onRestoreListScroll?: () => void;
  townApi?: TownApi;
  resolveCaptcha?: () => Promise<void>;
  onOpenFishingBattle?: (target: FishingBattleTarget) => void;
  characters?: HofCharacter[];
  partyPresetCatalog?: PartyPresetCatalogResource;
  onRunBattle?: (request: RunBattleRequest) => Promise<BattleResultResponse>;
  controlledMenuId?: TownMenuId | null;
  controlledDetailOpen?: boolean;
  onDetailStateChange?: (menuId: TownMenuId | null, open: boolean) => void;
  renderContent?: (content: ReactElement, virtualized: boolean) => ReactElement;
};

const townApiIdentities = new WeakMap<object, number>();
let nextTownApiIdentity = 1;

function getTownApiIdentity(api: TownApi | undefined): string {
  if (api == null) return 'missing';
  const existing = townApiIdentities.get(api);
  if (existing !== undefined) return String(existing);
  const identity = nextTownApiIdentity++;
  townApiIdentities.set(api, identity);
  return String(identity);
}

function assertNever(value: never): never {
  throw new Error(`지원하지 않는 마을 panel입니다: ${JSON.stringify(value)}`);
}

/** 승인된 모든 마을 기능을 한 화면에서 검색하고 상세로 여는 단일 shell이다. */
export function TownTabScreen({ onCaptureListScroll, onRestoreListScroll, townApi, resolveCaptcha, onOpenFishingBattle, characters, partyPresetCatalog, onRunBattle, controlledMenuId, controlledDetailOpen, onDetailStateChange, renderContent }: TownTabScreenProps) {
  const [categoryId, setCategoryId] = useState<TownCategoryFilterId>(DEFAULT_TOWN_CATEGORY_ID);
  const [query, setQuery] = useState('');
  const [internalMenuId, setInternalMenuId] = useState<TownMenuId | null>(null);
  const [internalDetailOpen, setInternalDetailOpen] = useState(false);
  const menuId = controlledMenuId === undefined ? internalMenuId : controlledMenuId;
  const detailOpen = controlledDetailOpen === undefined ? internalDetailOpen : controlledDetailOpen;
  const menuTriggerRefs = useRef(new Map<TownMenuId, NativeView>());
  const pendingFocusRestore = useRef<TownMenuId | null>(null);

  const visibleMenus = useMemo(() => searchTownMenus(query, categoryId), [categoryId, query]);
  const selectedMenu = menuId == null ? null : getTownMenuById(menuId) ?? null;
  const townApiIdentity = getTownApiIdentity(townApi);

  const closeDetail = useCallback(() => {
    pendingFocusRestore.current = menuId;
    if (onDetailStateChange) {
      onDetailStateChange(menuId, false);
    } else {
      setInternalDetailOpen(false);
    }
  }, [menuId, onDetailStateChange, onRestoreListScroll]);

  const changeDetail = useCallback((nextMenuId: TownMenuId | null, open: boolean) => {
    if (onDetailStateChange) onDetailStateChange(nextMenuId, open);
    else { setInternalMenuId(nextMenuId); setInternalDetailOpen(open); }
  }, [onDetailStateChange]);

  useEffect(() => {
    if (!detailOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeDetail();
      return true;
    });
    return () => subscription.remove();
  }, [closeDetail, detailOpen]);

  useEffect(() => {
    const restoreMenuId = pendingFocusRestore.current;
    if (detailOpen || restoreMenuId == null) return;
    pendingFocusRestore.current = null;
    onRestoreListScroll?.();
    const triggerHandle = getAccessibilityFocusTarget(menuTriggerRefs.current.get(restoreMenuId) ?? null);
    if (triggerHandle != null) focusAccessibilityTarget(triggerHandle);
  }, [detailOpen, onRestoreListScroll]);

  if (detailOpen && selectedMenu != null) {
    const route = TOWN_PANEL_REGISTRY[selectedMenu.id];
    const panel = townApi == null ? (
      <View accessibilityRole="alert" style={styles.apiUnavailable}>
        <Text style={styles.detailTitle}>마을 API를 사용할 수 없습니다.</Text>
        <Text style={styles.hint}>로그인 상태와 서버 연결을 확인한 뒤 다시 시도해 주세요.</Text>
      </View>
    ) : route.panel === 'fishing' ? (
      <FishingPanel
        api={townApi}
        mode={route.mode}
        characters={characters}
        partyPresetCatalog={partyPresetCatalog}
        onRunBattle={onRunBattle}
        onNavigateMode={(nextMode) => changeDetail(nextMode === 'fishing' ? 'fishing' : 'fishingExchange', true)}
        resolveCaptcha={resolveCaptcha}
      />
    ) : route.panel === 'shop' ? (
      <ShopPanel api={townApi} mode={route.mode} resolveCaptcha={resolveCaptcha} />
    ) : route.panel === 'auction' ? (
      <AuctionPanel api={townApi} mode={route.mode} resolveCaptcha={resolveCaptcha} />
    ) : route.panel === 'card' ? (
      <CardPanel api={townApi} mode={route.mode} resolveCaptcha={resolveCaptcha} />
    ) : route.panel === 'reward' ? (
      <RewardPanel api={townApi} mode={route.mode} resolveCaptcha={resolveCaptcha} />
    ) : route.panel === 'crafting' ? (
      <CraftingPanel api={townApi} mode={route.mode} resolveCaptcha={resolveCaptcha} />
    ) : route.panel === 'agency' ? (
      <AgencyPanel key={selectedMenu.id} api={townApi} mode={route.mode} resolveCaptcha={resolveCaptcha} />
    ) : route.panel === 'home' ? (
      <HomePanel key={`${selectedMenu.id}-${route.mode}`} api={townApi} mode={route.mode} resolveCaptcha={resolveCaptcha} />
    ) : route.panel === 'exchange' ? (
      <ExchangePanel key={`${selectedMenu.id}-${route.mode}`} api={townApi} mode={route.mode} resolveCaptcha={resolveCaptcha} />
    ) : route.panel === 'colosseum' ? (
      <ColosseumPanel
        key={`${selectedMenu.id}-${route.mode}`}
        api={townApi}
        mode={route.mode}
        characters={characters}
        partyPresetCatalog={partyPresetCatalog}
        resolveCaptcha={resolveCaptcha}
      />
    ) : route.panel === 'raid' ? (
      <RaidPanel key={selectedMenu.id} api={townApi} resolveCaptcha={resolveCaptcha} onOpenBattle={onOpenFishingBattle} />
    ) : route.panel === 'pantheon' ? (
      <PantheonPanel key={selectedMenu.id} api={townApi} resolveCaptcha={resolveCaptcha} />
    ) : (
      assertNever(route)
    );
    const panelKey = `${selectedMenu.id}:${townApiIdentity}`;
    const detail = (
      <TownDetailShell key={panelKey} menu={selectedMenu} onBack={closeDetail}>{panel}</TownDetailShell>
    );
    return renderContent?.(detail, route.virtualized) ?? detail;
  }

  const list = (
    <View style={styles.container}>
      <View style={styles.intro}>
        <Text style={styles.title}>마을</Text>
        <Text style={styles.hint}>생활, 거래, 제작과 특수 시설을 한곳에서 이용하세요.</Text>
      </View>

      <View style={styles.searchField}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="마을 메뉴 검색"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="메뉴명 검색"
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityLabel="검색어 지우기"
            accessibilityRole="button"
            onPress={() => setQuery('')}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <Text style={styles.clearLabel}>×</Text>
          </Pressable>
        ) : null}
      </View>

      <TownCategoryChips
        onSelectCategory={(nextCategoryId) => {
          setCategoryId(nextCategoryId);
          changeDetail(null, false);
        }}
        selectedCategoryId={categoryId}
      />

      <View style={styles.resultHeader}>
        <Text style={styles.resultTitle}>{categoryId === 'all' ? '전체 시설' : '선택한 시설'}</Text>
        <Text style={styles.resultCount}>{visibleMenus.length}개</Text>
      </View>

      <TownMenuGrid
        menus={visibleMenus}
        onSelectMenu={(nextMenuId) => {
          onCaptureListScroll?.();
          changeDetail(nextMenuId, true);
        }}
        onMenuTriggerRef={(nextMenuId, node) => {
          if (node == null) menuTriggerRefs.current.delete(nextMenuId);
          else menuTriggerRefs.current.set(nextMenuId, node);
        }}
        selectedMenuId={menuId}
      />
    </View>
  );
  return renderContent?.(list, false) ?? list;
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.md,
  },
  intro: {
    gap: theme.spacing.xs,
  },
  apiUnavailable: {
    gap: theme.spacing.xs,
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  hint: {
    color: theme.colors.textMuted,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accentBlue,
    paddingLeft: theme.spacing.md,
    fontSize: 13,
    lineHeight: 19,
  },
  searchField: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
  },
  searchIcon: {
    color: theme.colors.textMuted,
    fontSize: 20,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 14,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  clearButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearLabel: {
    color: theme.colors.textMuted,
    fontSize: 24,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  resultCount: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
  detailTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '900' },
});
