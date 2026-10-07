import store, {
  AISummaryContent,
  AISummaryFeedback,
  AISummaryFeedbackStatus,
  AISummarySurface,
  ITask,
  PostCallSubmissionResult,
  getAISummarySurface,
  isTelephonyTask,
} from '@webex/cc-store';
import {toEditableContent} from './ai-summary-mid-call';

export type WrapupCompletionResult = PostCallSubmissionResult;

export type CompleteWrapupWithSummaryParams = {
  task: ITask;
  wrapUpReason: string;
  auxCodeId: string;
  onWrapupCommitted?: () => void;
};

export type PostCallAISummaryView = {
  state: AISummarySurface;
  content: Extract<AISummaryContent, {type: 'sections' | 'text'}>;
  contentRevision: number;
  selectedFeedback: AISummaryFeedback;
  feedbackStatus?: AISummaryFeedbackStatus;
  requestPending: boolean;
};

const failedWrapup = (): WrapupCompletionResult => ({wrapup: 'failed'});

const notifyWrapupCommitted = (onWrapupCommitted?: () => void): void => {
  try {
    onWrapupCommitted?.();
  } catch {
    // The wrap-up result remains authoritative even if local commit bookkeeping fails.
  }
};

const isCallableWrapupTask = (
  task: ITask
): task is ITask & {wrapup: (payload: {wrapUpReason: string; auxCodeId: string}) => Promise<unknown>} =>
  typeof task?.wrapup === 'function';

/** The task's wrap-up summary, or undefined when the SDK reports post-call summaries as disabled for it. */
export const getPostCallSummaryView = (task?: ITask): PostCallAISummaryView | undefined => {
  if (!isTelephonyTask(task) || !task.aiSummaryCapabilities?.postCallEnabled) {
    return undefined;
  }
  const entry = store.aiSummaries[task.data.interactionId]?.['post-call'];
  return {
    state: getAISummarySurface(entry),
    content: toEditableContent(entry?.content),
    contentRevision: entry?.revision ?? 0,
    selectedFeedback: entry?.feedback ?? 'none',
    // Feedback is submitted with the final response after wrap-up.
    feedbackStatus: entry && entry.feedback !== 'none' ? 'pending' : undefined,
    requestPending: entry?.status === 'loading',
  };
};

const wrapupCompletionsInFlight = new WeakMap<ITask, Promise<WrapupCompletionResult>>();

const runCompleteWrapupWithSummary = async ({
  task,
  wrapUpReason,
  auxCodeId,
  onWrapupCommitted,
}: CompleteWrapupWithSummaryParams): Promise<WrapupCompletionResult> => {
  if (!isCallableWrapupTask(task)) {
    return failedWrapup();
  }

  // Take the response before wrap-up: the task and its summary are removed once wrap-up completes.
  const response = store.getPostCallSummaryResponse(auxCodeId, task);

  try {
    await task.wrapup({wrapUpReason, auxCodeId});
  } catch {
    return failedWrapup();
  }

  notifyWrapupCommitted(onWrapupCommitted);

  if (!response) {
    return {wrapup: 'succeeded', response: 'not-required'};
  }
  return {wrapup: 'succeeded', response: await store.sendPostCallSummaryResponse(response, task)};
};

/** Completes wrap-up, then sends the post-call summary response once. Concurrent calls share one attempt. */
export const completeWrapupWithSummary = (params: CompleteWrapupWithSummaryParams): Promise<WrapupCompletionResult> => {
  if (!isCallableWrapupTask(params.task)) {
    return Promise.resolve(failedWrapup());
  }

  const inFlight = wrapupCompletionsInFlight.get(params.task);
  if (inFlight) {
    return inFlight;
  }

  const completion = runCompleteWrapupWithSummary(params);
  wrapupCompletionsInFlight.set(params.task, completion);
  const clearInFlight = () => {
    if (wrapupCompletionsInFlight.get(params.task) === completion) {
      wrapupCompletionsInFlight.delete(params.task);
    }
  };
  void completion.then(clearInFlight, clearInFlight);
  return completion;
};
