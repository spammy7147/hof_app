import type { PartyPresetCatalogResponse } from '../types/api';

export type PartyPresetCatalogLoadResult =
  | { status: 'success'; catalog: PartyPresetCatalogResponse }
  | { status: 'failure'; error: unknown }
  | { status: 'stale' };

/** 카탈로그 캐시와 계정/요청 세대를 함께 조정한다. */
export class PartyPresetCatalogLoadCoordinator {
  private accountGeneration = 0;
  private requestGeneration = 0;
  private activeRequestGeneration: number | null = null;
  private loaded = false;

  start(
    load: () => Promise<PartyPresetCatalogResponse>,
    force = false,
  ): Promise<PartyPresetCatalogLoadResult> | null {
    if (!force && (this.activeRequestGeneration != null || this.loaded)) return null;

    const accountGeneration = this.accountGeneration;
    const requestGeneration = ++this.requestGeneration;
    this.activeRequestGeneration = requestGeneration;

    let request: Promise<PartyPresetCatalogResponse>;
    try {
      request = load();
    } catch (error) {
      request = Promise.reject(error);
    }

    return request.then<PartyPresetCatalogLoadResult, PartyPresetCatalogLoadResult>(
      (catalog) => {
        if (!this.isCurrent(accountGeneration, requestGeneration)) return { status: 'stale' };
        this.loaded = true;
        this.activeRequestGeneration = null;
        return { status: 'success', catalog };
      },
      (error: unknown) => {
        if (!this.isCurrent(accountGeneration, requestGeneration)) return { status: 'stale' };
        this.activeRequestGeneration = null;
        return { status: 'failure', error };
      },
    );
  }

  /** mutation이 반환한 최신 카탈로그를 채택하고 이전 조회 응답을 무효화한다. */
  replace(catalog: PartyPresetCatalogResponse): PartyPresetCatalogLoadResult {
    this.requestGeneration += 1;
    this.activeRequestGeneration = null;
    this.loaded = true;
    return { status: 'success', catalog };
  }

  /** 이전 계정의 캐시와 모든 요청 소유권을 폐기한다. */
  invalidate(): void {
    this.accountGeneration += 1;
    this.requestGeneration += 1;
    this.activeRequestGeneration = null;
    this.loaded = false;
  }

  private isCurrent(accountGeneration: number, requestGeneration: number): boolean {
    return accountGeneration === this.accountGeneration
      && requestGeneration === this.activeRequestGeneration;
  }
}
