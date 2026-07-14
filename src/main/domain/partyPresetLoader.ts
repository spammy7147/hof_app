import type { PartyPresetResponse } from '../types/api';

export type PartyPresetLoadResult =
  | { status: 'success'; presets: PartyPresetResponse[] }
  | { status: 'failure'; error: unknown }
  | { status: 'stale' };

/**
 * 파티 프리셋 조회의 성공 캐시, 단일 in-flight 요청, 계정 세대를 함께 조정한다.
 */
export class PartyPresetLoadCoordinator {
  private generation = 0;
  private loaded = false;
  private requestInFlight = false;

  start(
    load: () => Promise<PartyPresetResponse[]>,
    force = false,
  ): Promise<PartyPresetLoadResult> | null {
    if (this.requestInFlight || (!force && this.loaded)) return null;

    const requestGeneration = this.generation;
    this.requestInFlight = true;

    let request: Promise<PartyPresetResponse[]>;
    try {
      request = load();
    } catch (error) {
      request = Promise.reject(error);
    }

    return request.then<PartyPresetLoadResult, PartyPresetLoadResult>(
      (presets) => {
        if (requestGeneration !== this.generation) return { status: 'stale' };

        this.loaded = true;
        this.requestInFlight = false;
        return { status: 'success', presets };
      },
      (error: unknown) => {
        if (requestGeneration !== this.generation) return { status: 'stale' };

        this.requestInFlight = false;
        return { status: 'failure', error };
      },
    );
  }

  /** 이전 계정의 캐시와 요청 소유권을 폐기한다. */
  invalidate(): void {
    this.generation += 1;
    this.loaded = false;
    this.requestInFlight = false;
  }
}
