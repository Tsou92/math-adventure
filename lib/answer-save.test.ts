import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnswerSaveController,
  type SaveRequestItem,
  type SaveResponse,
} from './answer-save';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function conflictError(
  questionId: string,
  clientVersion: number,
  answerText = '',
) {
  return Object.assign(new Error('答案版本过期'), {
    data: {
      code: 'ANSWER_VERSION_STALE',
      questionId,
      clientVersion,
      answerText,
    },
  });
}

function echoSaved(items: SaveRequestItem[]): SaveResponse {
  return {
    saved: items.map((item) => ({
      questionId: item.questionId,
      answerText: item.answer,
      clientVersion: item.clientVersion,
    })),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AnswerSaveController', () => {
  it('q1 冲突接受服务端答案后，只清除冲突题并继续保存 q2', async () => {
    const calls: SaveRequestItem[][] = [];
    const request = vi.fn(async (items: SaveRequestItem[]) => {
      calls.push(items);
      if (calls.length === 1 && items.some((item) => item.questionId === 'q1'))
        throw conflictError('q1', 5, '9');
      return echoSaved(items);
    });
    const resolveConflict = vi.fn(() => 'server' as const);
    const controller = new AnswerSaveController({
      request,
      answers: { q1: '1', q2: '2' },
      versions: { q1: 1, q2: 1 },
      debounceMs: 10_000,
      resolveConflict,
    });

    controller.update('q1', '3');
    controller.update('q2', '4');
    await controller.flush();

    expect(resolveConflict).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().answers.q1).toBe('9');
    expect(controller.getSnapshot().versions.q1).toBe(5);
    expect(controller.getSnapshot().answers.q2).toBe('4');
    expect(
      calls.some((batch) => batch.some((item) => item.questionId === 'q2')),
    ).toBe(true);
    expect(controller.getState()).toBe('saved');
  });

  it('连续多个版本冲突会逐个处理并最终保存其余题目', async () => {
    const pending = new Set(['q1', 'q2']);
    const request = vi.fn(async (items: SaveRequestItem[]) => {
      const conflicting = items.find((item) => pending.has(item.questionId));
      if (conflicting) {
        pending.delete(conflicting.questionId);
        throw conflictError(
          conflicting.questionId,
          10,
          `server-${conflicting.questionId}`,
        );
      }
      return echoSaved(items);
    });
    const controller = new AnswerSaveController({
      request,
      answers: { q1: 'a', q2: 'b', q3: 'c' },
      versions: { q1: 1, q2: 1, q3: 1 },
      debounceMs: 10_000,
      resolveConflict: () => 'server',
    });
    controller.update('q1', '1');
    controller.update('q2', '2');
    controller.update('q3', '3');
    await controller.flush();

    expect(request).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().answers.q1).toBe('server-q1');
    expect(controller.getSnapshot().answers.q2).toBe('server-q2');
    expect(controller.getSnapshot().answers.q3).toBe('3');
    expect(controller.getState()).toBe('saved');
  });

  it('覆盖冲突时使用 serverVersion + 1 继续保存当前答案', async () => {
    const calls: SaveRequestItem[][] = [];
    const request = vi.fn(async (items: SaveRequestItem[]) => {
      calls.push(items);
      if (calls.length === 1) throw conflictError('q1', 7, 'server');
      return echoSaved(items);
    });
    const controller = new AnswerSaveController({
      request,
      answers: { q1: 'old' },
      versions: { q1: 3 },
      debounceMs: 10_000,
      resolveConflict: () => 'overwrite',
    });

    controller.update('q1', 'new');
    await controller.flush();

    expect(calls).toHaveLength(2);
    expect(calls[1][0].clientVersion).toBe(8);
    expect(calls[1][0].answer).toBe('new');
    expect(controller.getSnapshot().answers.q1).toBe('new');
    expect(controller.getState()).toBe('saved');
  });

  it('保存请求进行中的新编辑不会被旧响应清除 dirty', async () => {
    let releaseFirst: (value: SaveResponse) => void = () => undefined;
    const first = new Promise<SaveResponse>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: SaveRequestItem[][] = [];
    const request = vi.fn((items: SaveRequestItem[]) => {
      calls.push(items);
      if (calls.length === 1) return first;
      return Promise.resolve(echoSaved(items));
    });
    const controller = new AnswerSaveController({
      request,
      debounceMs: 10_000,
    });

    controller.update('q1', '1');
    const flushing = controller.flush();
    await tick();
    expect(calls).toHaveLength(1);

    controller.update('q1', '12');
    releaseFirst({
      saved: [{ questionId: 'q1', answerText: '1', clientVersion: 1 }],
    });
    await flushing;

    expect(calls).toHaveLength(2);
    expect(calls[1][0].answer).toBe('12');
    expect(calls[1][0].clientVersion).toBe(2);
    expect(controller.getState()).toBe('saved');
  });

  it('flush 串行等待全部未保存数据，后续 flush 复用同一队列', async () => {
    const calls: SaveRequestItem[][] = [];
    const resolvers: Array<(value: SaveResponse) => void> = [];
    const request = vi.fn((items: SaveRequestItem[]) => {
      calls.push(items);
      return new Promise<SaveResponse>((resolve) => {
        resolvers.push(resolve);
      });
    });
    const controller = new AnswerSaveController({
      request,
      debounceMs: 10_000,
    });

    controller.update('q1', '1');
    const first = controller.flush();
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].map((item) => item.questionId)).toEqual(['q1']);

    controller.update('q2', '2');
    const second = controller.flush();
    await tick();
    expect(calls).toHaveLength(1);

    resolvers[0](
      echoSaved([{ questionId: 'q1', answer: '1', clientVersion: 1 }]),
    );
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1].map((item) => item.questionId)).toEqual(['q2']);

    resolvers[1](
      echoSaved([{ questionId: 'q2', answer: '2', clientVersion: 1 }]),
    );
    await Promise.all([first, second]);
    expect(controller.getState()).toBe('saved');
    expect(controller.hasPending()).toBe(false);
  });

  it('网络失败保留 dirty 并允许重试成功', async () => {
    let shouldFail = true;
    const errors: string[] = [];
    const request = vi.fn(async (items: SaveRequestItem[]) => {
      if (shouldFail) throw new Error('网络开小差了');
      return echoSaved(items);
    });
    const controller = new AnswerSaveController({
      request,
      debounceMs: 10_000,
      onError: (message) => errors.push(message),
    });

    controller.update('q1', '5');
    await expect(controller.flush()).rejects.toThrow('网络开小差了');
    expect(controller.getState()).toBe('error');
    expect(controller.hasPending()).toBe(true);

    shouldFail = false;
    await controller.flush();
    expect(controller.getState()).toBe('saved');
    expect(request).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
  });

  it('dispose 清理 debounce 计时器', () => {
    vi.useFakeTimers();
    const request = vi.fn(async (items: SaveRequestItem[]) => echoSaved(items));
    const controller = new AnswerSaveController({ request, debounceMs: 700 });

    controller.update('q1', '1');
    expect(vi.getTimerCount()).toBe(1);

    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(700);
    expect(request).not.toHaveBeenCalled();
  });

  it('dispose 取消进行中的请求且不再弹出冲突确认', async () => {
    const captured: { signal?: AbortSignal } = {};
    const request = vi.fn(
      (items: SaveRequestItem[], signal: AbortSignal) =>
        new Promise<SaveResponse>((_resolve, reject) => {
          captured.signal = signal;
          signal.addEventListener('abort', () => {
            reject(conflictError(items[0]?.questionId ?? 'q1', 2, 'server'));
          });
        }),
    );
    const resolveConflict = vi.fn(() => 'overwrite' as const);
    const controller = new AnswerSaveController({
      request,
      debounceMs: 10_000,
      resolveConflict,
    });

    controller.update('q1', '1');
    const flushing = controller.flush();
    await tick();
    expect(request).toHaveBeenCalledTimes(1);

    controller.dispose();
    await expect(flushing).rejects.toMatchObject({ name: 'AbortError' });

    expect(captured.signal?.aborted).toBe(true);
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it('dispose 后 flush 以 AbortError 拒绝，不再发送交卷前的保存请求', async () => {
    const request = vi.fn(async (items: SaveRequestItem[]) => echoSaved(items));
    const controller = new AnswerSaveController({
      request,
      debounceMs: 10_000,
    });

    controller.update('q1', '1');
    controller.dispose();

    await expect(controller.flush()).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('冲突 resolver 抛错时状态为 error 且保留 dirty', async () => {
    const request = vi.fn(async () => {
      throw conflictError('q1', 4, 'server');
    });
    const resolverError = new Error('无法确认冲突处理方式');
    const controller = new AnswerSaveController({
      request,
      debounceMs: 10_000,
      resolveConflict: () => {
        throw resolverError;
      },
    });

    controller.update('q1', '2');
    await expect(controller.flush()).rejects.toBe(resolverError);
    expect(controller.getState()).toBe('error');
    expect(controller.hasPending()).toBe(true);
  });

  it('saved ack 与请求不一致时立即报协议错误并保留 dirty', async () => {
    const request = vi.fn(async (items: SaveRequestItem[]) => ({
      saved: items.map((item) => ({
        questionId: item.questionId,
        answerText: '被篡改的答案',
        clientVersion: item.clientVersion,
      })),
    }));
    const errors: string[] = [];
    const controller = new AnswerSaveController({
      request,
      debounceMs: 10_000,
      onError: (message) => errors.push(message),
    });

    controller.update('q1', '1');
    await expect(controller.flush()).rejects.toThrow('响应与请求不一致');
    expect(controller.getState()).toBe('error');
    expect(controller.hasPending()).toBe(true);
    expect(errors).toHaveLength(1);
    // 不再盲重试 25 轮，一次无效 ack 立即失败。
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('一批 ack 缺少某项时不部分清 dirty，重试仍携带整批题目', async () => {
    const calls: SaveRequestItem[][] = [];
    let ackAll = false;
    const request = vi.fn(async (items: SaveRequestItem[]) => {
      calls.push(items);
      if (!ackAll) {
        ackAll = true;
        // 只回 q1 的 ack，q2 缺失，属于整批不完整。
        const first = items[0];
        return {
          saved: [
            {
              questionId: first.questionId,
              answerText: first.answer,
              clientVersion: first.clientVersion,
            },
          ],
        };
      }
      return echoSaved(items);
    });
    const controller = new AnswerSaveController({
      request,
      debounceMs: 10_000,
    });

    controller.update('q1', '1');
    controller.update('q2', '2');
    await expect(controller.flush()).rejects.toThrow('响应与请求不一致');
    expect(controller.getState()).toBe('error');
    // 整批保留：q1 虽已出现在 ack 中，也不能在 q2 缺失时被清 dirty。
    expect(controller.hasPending()).toBe(true);

    await controller.flush();
    expect(calls).toHaveLength(2);
    expect(calls[0].map((item) => item.questionId).sort()).toEqual([
      'q1',
      'q2',
    ]);
    expect(calls[1].map((item) => item.questionId).sort()).toEqual([
      'q1',
      'q2',
    ]);
    expect(controller.getState()).toBe('saved');
    expect(controller.hasPending()).toBe(false);
  });

  it('成功 ack 后又有新编辑时，连续 30 轮不误报重试过多并最终保存', async () => {
    let calls = 0;
    const request = vi.fn(async (items: SaveRequestItem[]) => {
      calls += 1;
      const ack = echoSaved(items);
      // 每次保存成功后又立刻产生一次新编辑，制造「成功但仍有 dirty」的连续轮次。
      if (calls <= 30) controller.update('q1', `v${calls + 1}`);
      return ack;
    });
    const controller = new AnswerSaveController({ request, debounceMs: 10_000 });

    controller.update('q1', 'v1');
    await controller.flush();

    expect(calls).toBe(31);
    expect(controller.getState()).toBe('saved');
    expect(controller.hasPending()).toBe(false);
    expect(controller.getSnapshot().answers.q1).toBe('v31');
    expect(controller.getSnapshot().versions.q1).toBe(31);
    controller.dispose();
  });

  it('100 道题逐个接受服务端冲突后可完整保存', async () => {
    const total = 100;
    const answers: Record<string, string> = {};
    const versions: Record<string, number> = {};
    for (let i = 1; i <= total; i += 1) {
      answers[`q${i}`] = `local-${i}`;
      versions[`q${i}`] = 1;
    }
    const pending = new Set(Object.keys(answers));
    const request = vi.fn(async (items: SaveRequestItem[]) => {
      const conflicting = items.find((item) => pending.has(item.questionId));
      if (conflicting) {
        pending.delete(conflicting.questionId);
        throw conflictError(
          conflicting.questionId,
          5,
          `server-${conflicting.questionId}`,
        );
      }
      return echoSaved(items);
    });
    const controller = new AnswerSaveController({
      request,
      answers,
      versions,
      debounceMs: 10_000,
      resolveConflict: () => 'server',
    });

    for (let i = 1; i <= total; i += 1) controller.update(`q${i}`, `new-${i}`);
    await controller.flush();

    expect(request).toHaveBeenCalledTimes(total);
    expect(controller.getState()).toBe('saved');
    expect(controller.hasPending()).toBe(false);
    expect(controller.getSnapshot().answers.q1).toBe('server-q1');
    expect(controller.getSnapshot().answers.q100).toBe('server-q100');
  });

  it('同一冲突反复接受 overwrite 但服务端版本不前进时，有限次数后失败并保留 dirty', async () => {
    const request = vi.fn(async () => {
      throw conflictError('q1', 7, 'server');
    });
    const errors: string[] = [];
    const controller = new AnswerSaveController({
      request,
      answers: { q1: 'local' },
      versions: { q1: 1 },
      debounceMs: 10_000,
      resolveConflict: () => 'overwrite',
      onError: (message) => errors.push(message),
    });

    controller.update('q1', 'new');
    await expect(controller.flush()).rejects.toThrow('答案保存重试次数过多');
    expect(controller.getState()).toBe('error');
    // 无进展中止后 dirty 必须保留，供用户重试。
    expect(controller.hasPending()).toBe(true);
    expect(errors).toHaveLength(1);
    // 有界：首轮推进 version 后，连续 25 轮无进展即中止。
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(25);
    expect(request.mock.calls.length).toBeLessThanOrEqual(30);
  });
});
