import {aiSummaryFixtures} from '../../test-fixtures/src/aiSummaryFixtures';
import {
  composeMidCallResponse,
  composePostCallResponse,
  editAISummaryContent,
  getAISummarySurface,
  newAISummaryEntry,
  normalizeAISummaryPayload,
} from '../src/ai-summary';
import type {AISummaryContent, AISummaryEntry} from '../src/store.types';

const entryWith = (content: AISummaryContent, overrides: Partial<AISummaryEntry> = {}): AISummaryEntry => ({
  ...newAISummaryEntry(),
  status: 'ready',
  revision: 1,
  content,
  ...overrides,
});

const contentOf = (result: ReturnType<typeof normalizeAISummaryPayload>): AISummaryContent => {
  if (result.kind !== 'success') {
    throw new Error(`Expected a summary, got ${result.error}`);
  }
  return result.content;
};

describe('ai-summary', () => {
  describe('normalizeAISummaryPayload', () => {
    it('should keep the initiator sections in SDK order and drop unknown or blank ones', () => {
      const result = normalizeAISummaryPayload(
        {
          ...aiSummaryFixtures.initiatingMidCall.typedSections,
          sections: {
            ...aiSummaryFixtures.initiatingMidCall.typedSections.sections,
            unknown: 'Drop me',
            nextSteps: 'Not an initiator section',
          },
        },
        'initiator'
      );

      expect(contentOf(result)).toEqual({
        type: 'sections',
        resolution: undefined,
        sections: [
          {key: 'reasonForTransferOrConsult', value: 'Customer needs billing help.', editable: true},
          {key: 'additionalContext', value: 'Invoice discrepancy is the active topic.', editable: true},
          {key: 'keyActionsTaken', value: 'Verified account and checked invoice.', editable: true},
        ],
      });
    });

    it('should fall back to non-blank summaryText when no declared section has a value', () => {
      const result = normalizeAISummaryPayload(
        {
          conversationId: 'interaction-main-1',
          sections: {reasonForTransferOrConsult: '  ', unknown: 'Ignored'},
          summaryText: '  Plain text with original bytes.  ',
        },
        'initiator'
      );

      expect(contentOf(result)).toEqual({type: 'text', summaryText: '  Plain text with original bytes.  '});
    });

    it('should accept plain and structured post-call summaries and keep the resolution separate', () => {
      expect(contentOf(normalizeAISummaryPayload(aiSummaryFixtures.postCall.plainText, 'post-call')).type).toBe('text');

      const present = contentOf(normalizeAISummaryPayload(aiSummaryFixtures.postCall.resolutionPresent, 'post-call'));
      expect(present).toMatchObject({type: 'sections', resolution: 'Correction approved'});
      if (present.type === 'sections') {
        expect(present.sections.map((section) => section.key)).toEqual(['initialContactReason', 'nextSteps']);
      }

      for (const payload of [
        aiSummaryFixtures.postCall.resolutionAbsent,
        aiSummaryFixtures.postCall.resolutionEmptyBoundary,
      ]) {
        expect(contentOf(normalizeAISummaryPayload(payload, 'post-call'))).toMatchObject({resolution: undefined});
      }
    });

    it('should report card-only initiator and post-call payloads as unsupported', () => {
      expect(normalizeAISummaryPayload(aiSummaryFixtures.initiatingMidCall.cardOnlyUnsupported, 'initiator')).toEqual({
        kind: 'error',
        error: 'unsupported',
      });
      expect(normalizeAISummaryPayload(aiSummaryFixtures.postCall.cardOnlyUnsupported, 'post-call')).toEqual({
        kind: 'error',
        error: 'unsupported',
      });
    });

    it('should render only the adaptive card for the receiving agent', () => {
      expect(contentOf(normalizeAISummaryPayload(aiSummaryFixtures.receivingMidCall.adaptiveCard, 'receiver'))).toEqual(
        {
          type: 'card',
          adaptiveCard: aiSummaryFixtures.receivingMidCall.adaptiveCard.adaptiveCard,
        }
      );
      expect(normalizeAISummaryPayload(aiSummaryFixtures.receivingMidCall.typedOnlyUnsupported, 'receiver')).toEqual({
        kind: 'error',
        error: 'unsupported',
      });
      expect(
        normalizeAISummaryPayload({...aiSummaryFixtures.receivingMidCall.adaptiveCard, adaptiveCard: null}, 'receiver')
      ).toEqual({kind: 'error', error: 'unsupported'});
    });

    it('should report malformed and empty payloads as failures', () => {
      const failed = {kind: 'error', error: 'failed'};

      expect(normalizeAISummaryPayload(undefined, 'initiator')).toEqual(failed);
      expect(
        normalizeAISummaryPayload(
          {conversationId: 'interaction-main-1', sections: {reasonForTransferOrConsult: 42}},
          'initiator'
        )
      ).toEqual(failed);
      expect(normalizeAISummaryPayload({conversationId: 'interaction-main-1', summaryText: ' '}, 'post-call')).toEqual(
        failed
      );
      expect(normalizeAISummaryPayload({conversationId: 'interaction-main-1'}, 'post-call')).toEqual(failed);
    });
  });

  describe('getAISummarySurface', () => {
    it('should derive what the summary location shows from the entry', () => {
      expect(getAISummarySurface(undefined)).toBe('omitted');
      expect(getAISummarySurface({...newAISummaryEntry(), status: 'loading'})).toBe('generating');
      expect(getAISummarySurface(entryWith({type: 'text', summaryText: 'Summary'}, {status: 'loading'}))).toBe(
        'content'
      );
      expect(getAISummarySurface({...newAISummaryEntry(), status: 'error', error: 'failed'})).toBe('generic-error');
      expect(getAISummarySurface({...newAISummaryEntry(), status: 'error', error: 'unsupported'})).toBe('unavailable');
    });
  });

  describe('editAISummaryContent', () => {
    it('should apply a text edit and mark the summary edited without changing its revision', () => {
      const entry = entryWith({type: 'text', summaryText: 'Original'});

      expect(editAISummaryContent(entry, {key: 'summaryText', value: 'Edited'})).toEqual({
        ...entry,
        content: {type: 'text', summaryText: 'Edited'},
        edited: true,
      });
    });

    it('should edit only the matching section', () => {
      const entry = entryWith(contentOf(normalizeAISummaryPayload(aiSummaryFixtures.postCall.structured, 'post-call')));
      const edited = editAISummaryContent(entry, {key: 'nextSteps', value: 'Call back Friday.'});

      expect(edited).toMatchObject({revision: 1, edited: true});
      expect(edited?.content).toMatchObject({
        sections: expect.arrayContaining([{key: 'nextSteps', value: 'Call back Friday.', editable: true}]),
      });
      expect(edited?.content).toMatchObject({
        sections: expect.arrayContaining([expect.objectContaining({key: 'initialContactReason'})]),
      });
    });

    it('should accept an unchanged value as a no-op and reject fields the content does not have', () => {
      const text = entryWith({type: 'text', summaryText: 'Original'});
      const sections = entryWith({
        type: 'sections',
        sections: [{key: 'additionalContext', value: 'Context', editable: true}],
      });

      expect(editAISummaryContent(text, {key: 'summaryText', value: 'Original'})).toBe(text);
      expect(editAISummaryContent(text, {key: 'additionalContext', value: 'x'})).toBeUndefined();
      expect(editAISummaryContent(sections, {key: 'summaryText', value: 'x'})).toBeUndefined();
      expect(editAISummaryContent(sections, {key: 'nextSteps', value: 'x'})).toBeUndefined();
      expect(editAISummaryContent({...newAISummaryEntry(), status: 'ready'}, {key: 'summaryText', value: 'x'})).toBe(
        undefined
      );
    });
  });

  describe('response composition', () => {
    it('should report a received mid-call summary with its sections, feedback, edit flag and copies', () => {
      const entry = entryWith(
        contentOf(normalizeAISummaryPayload(aiSummaryFixtures.initiatingMidCall.typedSections, 'initiator')),
        {copied: 2, edited: true, feedback: 'like'}
      );

      expect(composeMidCallResponse(entry)).toEqual({
        summary: {
          reasonForTransferOrConsult: 'Customer needs billing help.',
          additionalContext: 'Invoice discrepancy is the active topic.',
          keyActionsTaken: 'Verified account and checked invoice.',
        },
        feedback: 'thumbs_up',
        state: 'DEFAULT',
        numberOfTimesViewed: 1,
        numberOfTimesEdited: 1,
        numberOfTimesCopied: 2,
        summaryReceived: true,
      });
    });

    it('should compose the receiving agent response from the adaptive card text', () => {
      const entry = entryWith(
        contentOf(normalizeAISummaryPayload(aiSummaryFixtures.receivingMidCall.adaptiveCard, 'receiver'))
      );

      expect(composeMidCallResponse(entry)).toMatchObject({
        summary: 'Customer needs billing help.\nInvoice discrepancy is the active topic.',
        feedback: 'none',
      });
    });

    it('should report a summary that failed as not received and one still pending as ignored', () => {
      const notReceived = {
        summary: '',
        feedback: 'none',
        state: 'NOT_RECEIVED',
        numberOfTimesViewed: 0,
        numberOfTimesEdited: 0,
        numberOfTimesCopied: 0,
        summaryReceived: false,
      };

      expect(composeMidCallResponse({...newAISummaryEntry(), status: 'error', error: 'failed'})).toEqual(notReceived);
      expect(composeMidCallResponse({...newAISummaryEntry(), status: 'loading'})).toEqual({
        ...notReceived,
        state: 'IGNORED',
      });
      expect(composeMidCallResponse(undefined)).toEqual({...notReceived, state: 'IGNORED'});
    });

    it('should always compose the post-call response with the wrap-up code', () => {
      const entry = entryWith({type: 'text', summaryText: 'Resolved billing issue.'}, {feedback: 'dislike'});

      expect(composePostCallResponse(entry, 'aux-billing')).toEqual({
        summary: 'Resolved billing issue.',
        feedback: 'thumbs_down',
        state: 'DEFAULT',
        numberOfTimesViewed: 1,
        numberOfTimesEdited: 0,
        numberOfTimesCopied: 0,
        summaryReceived: true,
        wrapUpCode: 'aux-billing',
      });
      expect(composePostCallResponse(undefined, 'aux-billing')).toMatchObject({
        summary: '',
        state: 'IGNORED',
        wrapUpCode: 'aux-billing',
      });
    });
  });
});
