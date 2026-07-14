/**
 * 드래그가 빠르게 반복되어도 서버에는 한 번에 하나의 순서 요청만 보내는 작은 조정기다.
 *
 * 화면은 드롭 즉시 로컬 배열을 바꾸고 `enqueue`를 호출한다. 저장 중 새 순서가 들어오면 중간 순서는
 * 버리고 가장 마지막 순서만 보관한다. 최종 요청만 화면에 확정하며, 어느 요청이든 실패하면 대기
 * 순서를 모두 버리고 호출자가 서버 상태를 다시 읽도록 한다.
 */
export class UnifiedAutomationReorderQueue<T> {
  private inFlight = false;
  private pendingOrder: number[] | null = null;
  private idleResolvers: Array<() => void> = [];

  constructor(
    private readonly persist: (moduleIds: number[]) => Promise<T>,
    private readonly onSaved: (result: T) => void,
    private readonly onFailure: (error: unknown) => Promise<void>,
    private readonly onPersisted?: (result: T, moduleIds: number[]) => void,
  ) {}

  /** 최신 사용자 순서를 복사해 보관하고 비동기 저장 루프를 시작한다. */
  enqueue(moduleIds: number[]): void {
    this.pendingOrder = [...moduleIds];
    if (!this.inFlight) void this.drain();
  }

  /** 테스트와 화면 종료 처리가 모든 대기 요청이 끝나는 시점을 기다릴 수 있게 한다. */
  whenIdle(): Promise<void> {
    if (!this.inFlight && this.pendingOrder == null) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      while (this.pendingOrder != null) {
        const order = this.pendingOrder;
        this.pendingOrder = null;
        try {
          const result = await this.persist(order);
          this.onPersisted?.(result, order);
          if (this.pendingOrder == null) this.onSaved(result);
        } catch (error) {
          this.pendingOrder = null;
          await this.onFailure(error);
          break;
        }
      }
    } finally {
      this.inFlight = false;
      const resolvers = this.idleResolvers;
      this.idleResolvers = [];
      resolvers.forEach((resolve) => resolve());
      if (this.pendingOrder != null) void this.drain();
    }
  }
}
