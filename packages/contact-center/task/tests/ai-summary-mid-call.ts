import store from '@webex/cc-store';
import type {AISummaryEntry, ITask} from '@webex/cc-store';
import {getMidCallSummaryView, toEditableContent} from '../src/ai-summary-mid-call';

const INTERACTION_ID = 'interaction-1';

const makeTask = (overrides: {mediaType?: string; midCallEnabled?: boolean} = {}): ITask =>
  ({
    data: {interactionId: INTERACTION_ID, interaction: {mediaType: overrides.mediaType ?? 'telephony'}},
    aiSummaryCapabilities: {midCallEnabled: overrides.midCallEnabled ?? true, postCallEnabled: true},
  }) as unknown as ITask;

const entry = (overrides: Partial<AISummaryEntry> = {}): AISummaryEntry => ({
  status: 'ready',
  revision: 1,
  copied: 0,
  edited: false,
  feedback: 'none',
  ...overrides,
});

const setInitiatorEntry = (initiator?: AISummaryEntry) => {
  store.store.aiSummaries = initiator ? {[INTERACTION_ID]: {initiator}} : {};
};

describe('ai-summary-mid-call', () => {
  afterEach(() => {
    setInitiatorEntry();
  });

  it('should hide the summary when the SDK reports mid-call summaries as disabled for the task', () => {
    setInitiatorEntry(entry({content: {type: 'text', summaryText: 'Summary'}}));

    expect(getMidCallSummaryView('CONSULT', makeTask({midCallEnabled: false}))).toBeUndefined();
    expect(getMidCallSummaryView('CONSULT', makeTask({mediaType: 'chat'}))).toBeUndefined();
    expect(getMidCallSummaryView('CONSULT', undefined)).toBeUndefined();
  });

  it('should show an omitted summary before the first request for an enabled task', () => {
    expect(getMidCallSummaryView('TRANSFER', makeTask())).toEqual({
      state: 'omitted',
      content: {type: 'text', summaryText: ''},
      contentRevision: 0,
      actionType: 'TRANSFER',
      selectedFeedback: 'none',
      requestPending: false,
    });
  });

  it('should show generating while the first request is loading', () => {
    setInitiatorEntry(entry({status: 'loading', revision: 0}));

    expect(getMidCallSummaryView('CONSULT', makeTask())).toMatchObject({
      state: 'generating',
      requestPending: true,
    });
  });

  it('should keep the shown summary and its action while a newer request is loading', () => {
    setInitiatorEntry(
      entry({
        status: 'loading',
        revision: 3,
        content: {type: 'text', summaryText: 'Existing summary'},
        actionType: 'CONSULT',
        feedback: 'like',
      })
    );

    expect(getMidCallSummaryView('TRANSFER', makeTask())).toEqual({
      state: 'content',
      content: {type: 'text', summaryText: 'Existing summary'},
      contentRevision: 3,
      actionType: 'CONSULT',
      selectedFeedback: 'like',
      requestPending: true,
    });
  });

  it('should treat a feedback response in flight as pending', () => {
    setInitiatorEntry(entry({content: {type: 'text', summaryText: 'Summary'}, feedbackPending: true}));

    expect(getMidCallSummaryView('CONSULT', makeTask())?.requestPending).toBe(true);
  });

  it('should map failures to the error and unavailable surfaces', () => {
    setInitiatorEntry(entry({status: 'error', error: 'failed'}));
    expect(getMidCallSummaryView('CONSULT', makeTask())?.state).toBe('generic-error');

    setInitiatorEntry(entry({status: 'error', error: 'unsupported'}));
    expect(getMidCallSummaryView('CONSULT', makeTask())?.state).toBe('unavailable');
  });

  it('should never expose adaptive card content as editable content', () => {
    expect(toEditableContent({type: 'card', adaptiveCard: {type: 'AdaptiveCard'}})).toEqual({
      type: 'text',
      summaryText: '',
    });
    expect(toEditableContent({type: 'text', summaryText: 'Plain'})).toEqual({type: 'text', summaryText: 'Plain'});
  });
});
