import store, {ITask} from '@webex/cc-store';
import {aiSummaryFixtures} from '@webex/test-fixtures';
import type {AISummary, AISummaryResponse} from '@webex/contact-center';
import {completeWrapupWithSummary, getPostCallSummaryView} from '../src/ai-summary-post-call';

type PostCallTestTask = ITask & {
  requestPostCallSummary: jest.Mock<Promise<AISummary>, []>;
  sendPostCallSummaryResponse: jest.Mock<Promise<void>, [AISummaryResponse]>;
  wrapup: jest.Mock<Promise<unknown>, [{wrapUpReason: string; auxCodeId: string}]>;
};

const INTERACTION_ID = 'interaction-main-1';

const deferred = <T = unknown>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {promise, resolve, reject};
};

const createPostCallTask = (overrides: Partial<PostCallTestTask> = {}): PostCallTestTask =>
  ({
    data: {interactionId: INTERACTION_ID, interaction: {mediaType: 'telephony'}},
    aiSummaryCapabilities: {midCallEnabled: true, postCallEnabled: true},
    requestPostCallSummary: jest.fn().mockResolvedValue(aiSummaryFixtures.postCall.plainText),
    sendPostCallSummaryResponse: jest.fn().mockResolvedValue(undefined),
    wrapup: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as PostCallTestTask;

const postCallEntry = () => store.aiSummaries[INTERACTION_ID]?.['post-call'];

const wrapUp = (task: PostCallTestTask, onWrapupCommitted?: () => void) =>
  completeWrapupWithSummary({task, wrapUpReason: 'Billing', auxCodeId: 'aux-billing', onWrapupCommitted});

describe('ai-summary-post-call', () => {
  beforeEach(() => {
    store.store.aiSummaries = {};
  });

  afterEach(() => {
    jest.restoreAllMocks();
    store.store.aiSummaries = {};
  });

  describe('getPostCallSummaryView', () => {
    it('should hide the summary when the SDK reports post-call summaries as disabled for the task', () => {
      expect(
        getPostCallSummaryView(
          createPostCallTask({aiSummaryCapabilities: {midCallEnabled: true, postCallEnabled: false}})
        )
      ).toBeUndefined();
    });

    it('should show generating while the first request is pending', async () => {
      const generation = deferred<AISummary>();
      const task = createPostCallTask({requestPostCallSummary: jest.fn(() => generation.promise)});

      const request = store.requestPostCallSummary(task);

      expect(getPostCallSummaryView(task)).toMatchObject({state: 'generating', requestPending: true});
      generation.resolve(aiSummaryFixtures.postCall.plainText);
      await request;
      expect(getPostCallSummaryView(task)).toMatchObject({
        state: 'content',
        content: {type: 'text'},
        requestPending: false,
      });
    });

    it('should show the error after a failure and generating again while Retry is pending', async () => {
      const retry = deferred<AISummary>();
      const task = createPostCallTask({
        requestPostCallSummary: jest
          .fn()
          .mockRejectedValueOnce(new Error('POST_CALL_SUMMARY_TIMEOUT'))
          .mockImplementationOnce(() => retry.promise),
      });

      await store.requestPostCallSummary(task);
      expect(getPostCallSummaryView(task)?.state).toBe('generic-error');

      const retryRequest = store.requestPostCallSummary(task);
      expect(getPostCallSummaryView(task)?.state).toBe('generating');

      retry.resolve(aiSummaryFixtures.postCall.plainText);
      await retryRequest;
      expect(getPostCallSummaryView(task)?.state).toBe('content');
    });

    it('should describe local feedback as pending until the final response', async () => {
      const task = createPostCallTask();
      await store.requestPostCallSummary(task);

      expect(store.setPostCallSummaryFeedback('like', postCallEntry().revision, task)).toBe(true);
      expect(getPostCallSummaryView(task)).toMatchObject({selectedFeedback: 'like', feedbackStatus: 'pending'});
    });
  });

  describe('completeWrapupWithSummary', () => {
    it('should wrap up without a summary response when post-call summaries are disabled', async () => {
      const task = createPostCallTask({aiSummaryCapabilities: {midCallEnabled: true, postCallEnabled: false}});

      await expect(wrapUp(task)).resolves.toEqual({wrapup: 'succeeded', response: 'not-required'});
      expect(task.wrapup).toHaveBeenCalledWith({wrapUpReason: 'Billing', auxCodeId: 'aux-billing'});
      expect(task.sendPostCallSummaryResponse).not.toHaveBeenCalled();
    });

    it('should report a wrap-up before the summary arrived as ignored', async () => {
      const task = createPostCallTask({requestPostCallSummary: jest.fn(() => new Promise<AISummary>(() => undefined))});
      void store.requestPostCallSummary(task);

      await expect(wrapUp(task)).resolves.toEqual({wrapup: 'succeeded', response: 'submitted'});
      expect(task.sendPostCallSummaryResponse).toHaveBeenCalledWith(
        expect.objectContaining({summary: '', state: 'IGNORED', wrapUpCode: 'aux-billing'})
      );
    });

    it('should send the edited summary, counters, feedback and wrap-up code once after wrap-up succeeds', async () => {
      const order: string[] = [];
      const task = createPostCallTask();
      await store.requestPostCallSummary(task);
      store.editAISummary('post-call', {key: 'summaryText', value: 'Edited summary'}, postCallEntry().revision, task);
      store.setPostCallSummaryFeedback('dislike', postCallEntry().revision, task);
      task.wrapup.mockImplementation(async () => {
        order.push('wrapup');
      });
      task.sendPostCallSummaryResponse.mockImplementation(async () => {
        order.push('response');
      });

      await expect(wrapUp(task, () => order.push('commit'))).resolves.toEqual({
        wrapup: 'succeeded',
        response: 'submitted',
      });
      expect(order).toEqual(['wrapup', 'commit', 'response']);
      expect(task.sendPostCallSummaryResponse).toHaveBeenCalledTimes(1);
      expect(task.sendPostCallSummaryResponse).toHaveBeenCalledWith({
        summary: 'Edited summary',
        feedback: 'thumbs_down',
        state: 'DEFAULT',
        numberOfTimesViewed: 1,
        numberOfTimesEdited: 1,
        numberOfTimesCopied: 0,
        summaryReceived: true,
        wrapUpCode: 'aux-billing',
      });
    });

    it('should still send the response when wrap-up removes the task before its promise settles', async () => {
      const task = createPostCallTask();
      await store.requestPostCallSummary(task);
      task.wrapup.mockImplementation(async () => {
        store.store.aiSummaries = {};
      });

      await expect(wrapUp(task)).resolves.toEqual({wrapup: 'succeeded', response: 'submitted'});
      expect(task.sendPostCallSummaryResponse).toHaveBeenCalledWith(
        expect.objectContaining({summary: expect.any(String)})
      );
      expect(postCallEntry()).toBeUndefined();
    });

    it('should keep the summary and send nothing when wrap-up fails', async () => {
      const task = createPostCallTask({wrapup: jest.fn().mockRejectedValue(new Error('wrap-up failed'))});
      await store.requestPostCallSummary(task);

      await expect(wrapUp(task)).resolves.toEqual({wrapup: 'failed'});
      expect(task.sendPostCallSummaryResponse).not.toHaveBeenCalled();
      expect(getPostCallSummaryView(task)?.state).toBe('content');
    });

    it('should report response-failed without retrying when the summary response fails', async () => {
      const task = createPostCallTask({
        sendPostCallSummaryResponse: jest.fn().mockRejectedValue(new Error('503')),
      });
      await store.requestPostCallSummary(task);
      store.setPostCallSummaryFeedback('like', postCallEntry().revision, task);

      await expect(wrapUp(task)).resolves.toEqual({wrapup: 'succeeded', response: 'response-failed'});
      expect(task.sendPostCallSummaryResponse).toHaveBeenCalledTimes(1);
    });

    it('should share one completion between concurrent calls for the same task', async () => {
      const wrapup = deferred<void>();
      const task = createPostCallTask();
      task.wrapup.mockImplementation(() => wrapup.promise);
      await store.requestPostCallSummary(task);

      const first = wrapUp(task);
      const second = wrapUp(task);
      wrapup.resolve();

      expect(second).toBe(first);
      await expect(first).resolves.toEqual({wrapup: 'succeeded', response: 'submitted'});
      expect(task.wrapup).toHaveBeenCalledTimes(1);
      expect(task.sendPostCallSummaryResponse).toHaveBeenCalledTimes(1);
    });

    it('should fail without calling the SDK when the task cannot wrap up', async () => {
      await expect(
        completeWrapupWithSummary({task: {} as ITask, wrapUpReason: 'Billing', auxCodeId: 'aux-billing'})
      ).resolves.toEqual({wrapup: 'failed'});
    });
  });
});
