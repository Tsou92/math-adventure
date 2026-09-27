export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export type SaveRequestItem = {
  questionId: string;
  answer: string;
  clientVersion: number;
};

export type SavedAnswer = {
  questionId: string;
  answerText: string;
  clientVersion: number;
};

export type SaveResponse = {
  saved?: SavedAnswer[];
};

export type SaveConflict = {
  code: string;
  questionId: string;
  answerText?: string;
  clientVersion?: number;
};

export type ConflictChoice = 'server' | 'overwrite';

export type AnswerSaveSnapshot = {
  answers: Record<string, string>;
  versions: Record<string, number>;
};

export type AnswerSaveTransport = (
  answers: SaveRequestItem[],
  signal: AbortSignal,
) => Promise<SaveResponse>;

export type AnswerSaveOptions = {
  request: AnswerSaveTransport;
  answers?: Record<string, string>;
  versions?: Record<string, number>;
  debounceMs?: number;
  resolveConflict?: (
    conflict: SaveConflict,
  ) => ConflictChoice | Promise<ConflictChoice>;
  isConflict?: (error: unknown) => SaveConflict | null;
  onSnapshot?: (snapshot: AnswerSaveSnapshot) => void;
  onState?: (state: SaveState) => void;
  onError?: (message: string, error: unknown) => void;
};

export const ANSWER_SAVE_DEBOUNCE_MS = 700;
/**
 * 连续「无进展」轮数上限。这里只统计连续没有任何进展的轮数，与单批
 * 题目数量无关：成功批次中已确认匹配的 ack、冲突被解决后清除 dirty
 * 或推进 version 都算进展并清零计数，因此正常连续编辑、逐个处理冲突
 * 都不会被误判；只有反复卡住（例如同一冲突反复 overwrite 但服务端
 * 版本不前进）才在连续 25 轮无进展后中止。
 */
const MAX_NO_PROGRESS_ROUNDS = 25;

type ErrorWithData = {
  data?: {
    code?: string;
    questionId?: string;
    answerText?: string;
    clientVersion?: number;
  };
};

function abortError(): Error {
  const error = new Error('答案保存已取消');
  error.name = 'AbortError';
  return error;
}

function defaultIsConflict(error: unknown): SaveConflict | null {
  const data = (error as ErrorWithData | null)?.data;
  if (!data || data.code !== 'ANSWER_VERSION_STALE' || !data.questionId)
    return null;
  return {
    code: data.code,
    questionId: data.questionId,
    answerText: data.answerText,
    clientVersion: data.clientVersion,
  };
}

/**
 * 与 React 解耦的答案保存控制器：
 * - 700ms debounce，保存请求串行化（队列 + 单请求在途）
 * - 请求在途时的新编辑不会被旧响应清除 dirty
 * - 版本冲突可逐个处理：接受服务端只清除冲突题并继续 flush 其余题；
 *   覆盖则使用 serverVersion + 1 继续保存
 * - 网络失败保留 dirty，可重试
 * - dispose 清 timer、取消在途请求，且不再弹冲突确认；此后 flush/drain
 *   以 AbortError 拒绝，避免已卸载页面继续发交卷请求
 */
export class AnswerSaveController {
  private readonly options: AnswerSaveOptions;
  private readonly answers: Record<string, string>;
  private readonly versions: Record<string, number>;
  private readonly dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private state: SaveState = 'idle';

  constructor(options: AnswerSaveOptions) {
    this.options = options;
    this.answers = { ...options.answers };
    this.versions = { ...options.versions };
  }

  getState(): SaveState {
    return this.state;
  }

  getSnapshot(): AnswerSaveSnapshot {
    return { answers: { ...this.answers }, versions: { ...this.versions } };
  }

  hasPending(): boolean {
    return this.dirty.size > 0 || this.abortController !== null;
  }

  update(questionId: string, value: string): void {
    if (this.disposed) return;
    this.answers[questionId] = value;
    this.versions[questionId] = (this.versions[questionId] ?? 0) + 1;
    this.dirty.add(questionId);
    this.setState('dirty');
    this.emitSnapshot();
    this.schedule();
  }

  /** 清掉 debounce 计时器并等待所有未保存数据落库。 */
  flush(): Promise<void> {
    if (this.disposed) return Promise.reject(abortError());
    this.clearTimer();
    const run = this.queue.then(() => this.drain());
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  retry(): Promise<void> {
    return this.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    const controller = this.abortController;
    this.abortController = null;
    controller?.abort();
    this.dirty.clear();
  }

  private schedule(): void {
    this.clearTimer();
    const delay = this.options.debounceMs ?? ANSWER_SAVE_DEBOUNCE_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private buildBatch(): SaveRequestItem[] {
    const batch: SaveRequestItem[] = [];
    for (const questionId of this.dirty) {
      batch.push({
        questionId,
        answer: this.answers[questionId] ?? '',
        clientVersion: this.versions[questionId] ?? 0,
      });
    }
    return batch;
  }

  private async resolveConflict(
    conflict: SaveConflict,
  ): Promise<ConflictChoice> {
    if (!this.options.resolveConflict) return 'server';
    const choice = await this.options.resolveConflict(conflict);
    return choice === 'overwrite' ? 'overwrite' : 'server';
  }

  private applySaved(batch: SaveRequestItem[], response: SaveResponse): void {
    const savedById = new Map(
      (response?.saved ?? []).map((item) => [item.questionId, item]),
    );
    // 先整批校验 ack 完整性：questionId、clientVersion、answerText
    // 任一不匹配都视为协议错误。校验全部通过前不改动 dirty/版本，
    // 避免部分有效 ack 已经清掉 dirty 后又发现另一项缺失。
    for (const requestItem of batch) {
      const saved = savedById.get(requestItem.questionId);
      if (
        !saved ||
        saved.clientVersion !== requestItem.clientVersion ||
        saved.answerText !== requestItem.answer
      ) {
        throw new Error('答案保存响应与请求不一致，请刷新页面后重试');
      }
    }
    // 整批校验通过后，再统一推进版本并清理已确认保存的 dirty。
    for (const requestItem of batch) {
      const saved = savedById.get(requestItem.questionId)!;
      const current = this.versions[requestItem.questionId] ?? 0;
      this.versions[requestItem.questionId] = Math.max(
        current,
        saved.clientVersion,
      );
      // 只有提交后版本没再变化，才认为这道题已经保存成功。
      if (current === requestItem.clientVersion)
        this.dirty.delete(requestItem.questionId);
    }
  }

  private async drain(): Promise<void> {
    if (this.disposed) throw abortError();
    let rounds = 0;
    let noProgress = 0;
    while (!this.disposed && this.dirty.size > 0) {
      rounds += 1;
      const batch = this.buildBatch();
      if (!batch.length) {
        this.dirty.clear();
        break;
      }
      this.setState('saving');
      const controller = new AbortController();
      this.abortController = controller;
      let response: SaveResponse = {};
      let handledConflict = false;
      let madeProgress = false;
      try {
        response = await this.options.request(batch, controller.signal);
      } catch (error) {
        if (this.abortController === controller) this.abortController = null;
        if (this.disposed) throw abortError();
        const conflict = (this.options.isConflict ?? defaultIsConflict)(error);
        if (conflict && conflict.questionId) {
          let choice: ConflictChoice;
          try {
            choice = await this.resolveConflict(conflict);
          } catch (resolveError) {
            if (this.disposed) throw abortError();
            this.fail(resolveError);
            throw resolveError;
          }
          if (this.disposed) throw abortError();
          handledConflict = true;
          if (choice === 'overwrite') {
            const serverVersion = conflict.clientVersion ?? 0;
            const current = this.versions[conflict.questionId] ?? 0;
            const next = serverVersion + 1;
            // 覆盖只有把本地版本推进到服务端版本之后才算进展；
            // 服务端不前进时重复同一冲突属于无进展。
            madeProgress = next > current;
            this.versions[conflict.questionId] = next;
            this.dirty.add(conflict.questionId);
            this.emitSnapshot();
          } else {
            // 接受服务端答案：清除该题 dirty 即为一次进展。
            this.answers[conflict.questionId] = conflict.answerText ?? '';
            this.versions[conflict.questionId] = conflict.clientVersion ?? 0;
            madeProgress = this.dirty.delete(conflict.questionId);
            this.emitSnapshot();
          }
        } else {
          this.fail(error);
          throw error;
        }
      }
      if (!handledConflict) {
        if (this.abortController === controller) this.abortController = null;
        if (this.disposed) throw abortError();
        try {
          // 已确认匹配的成功 ack 本身就是进展，即使期间又有新编辑让
          // 题目重新变 dirty；无效 ack 会立即抛协议错误并保留 dirty。
          this.applySaved(batch, response);
        } catch (protocolError) {
          this.fail(protocolError);
          throw protocolError;
        }
        madeProgress = true;
        this.emitSnapshot();
      }
      if (madeProgress) {
        noProgress = 0;
      } else {
        noProgress += 1;
        if (noProgress >= MAX_NO_PROGRESS_ROUNDS) {
          const error = new Error('答案保存重试次数过多，请检查网络后重试');
          this.fail(error);
          throw error;
        }
      }
      this.setState(this.dirty.size ? 'dirty' : 'saved');
    }
    if (!this.disposed && rounds > 0 && this.dirty.size === 0)
      this.setState('saved');
  }

  private fail(error: unknown): void {
    this.setState('error');
    const message =
      error instanceof Error && error.message
        ? error.message
        : '答案暂时没有保存，请检查网络';
    this.options.onError?.(message, error);
  }

  private setState(next: SaveState): void {
    if (this.state === next) return;
    this.state = next;
    this.options.onState?.(next);
  }

  private emitSnapshot(): void {
    this.options.onSnapshot?.({
      answers: { ...this.answers },
      versions: { ...this.versions },
    });
  }
}
