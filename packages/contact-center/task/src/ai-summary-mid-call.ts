import store, {
  AISummaryActionType,
  AISummaryContent,
  AISummaryFeedback,
  AISummarySurface,
  ITask,
  getAISummarySurface,
  isTelephonyTask,
} from '@webex/cc-store';

export type MidCallAISummaryView = {
  state: AISummarySurface;
  content: Extract<AISummaryContent, {type: 'sections' | 'text'}>;
  contentRevision: number;
  actionType: AISummaryActionType;
  selectedFeedback: AISummaryFeedback;
  requestPending: boolean;
};

const EMPTY_TEXT_CONTENT: Extract<AISummaryContent, {type: 'text'}> = {type: 'text', summaryText: ''};

export const toEditableContent = (
  content?: AISummaryContent
): Extract<AISummaryContent, {type: 'sections' | 'text'}> =>
  content?.type === 'sections' || content?.type === 'text' ? content : EMPTY_TEXT_CONTENT;

/**
 * The initiating agent's consult/transfer summary for a task, or undefined when the SDK reports mid-call
 * summaries as disabled for it.
 */
export const getMidCallSummaryView = (
  actionType: AISummaryActionType,
  task?: ITask
): MidCallAISummaryView | undefined => {
  if (!isTelephonyTask(task) || !task.aiSummaryCapabilities?.midCallEnabled) {
    return undefined;
  }
  const entry = store.aiSummaries[task.data.interactionId]?.initiator;
  return {
    state: getAISummarySurface(entry),
    content: toEditableContent(entry?.content),
    contentRevision: entry?.revision ?? 0,
    actionType: entry?.actionType ?? actionType,
    selectedFeedback: entry?.feedback ?? 'none',
    requestPending: entry?.status === 'loading' || Boolean(entry?.feedbackPending),
  };
};
