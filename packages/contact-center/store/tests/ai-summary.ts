import {aiSummaryFixtures} from '../../test-fixtures/src/aiSummaryFixtures';
import {
  composeAISummaryResponse,
  editAISummaryContent,
  getAISummarySurface,
  newAISummaryEntry,
  normalizeAISummaryPayload,
} from '../src/ai-summary';
import type {AISummaryEntry} from '../src/store.types';

type AISummaryContent = NonNullable<AISummaryEntry['content']>;

const entryWith = (content: AISummaryContent, overrides: Partial<AISummaryEntry> = {}): AISummaryEntry => ({
  ...newAISummaryEntry(),
  status: 'ready',
  revision: 1,
  content,
  originalSections: content.sections ? {...content.sections} : undefined,
  ...overrides,
});

const contentOf = (result: ReturnType<typeof normalizeAISummaryPayload>): AISummaryContent => {
  if (typeof result === 'string') {
    throw new Error(`Expected a summary, got ${result}`);
  }
  return result;
};

describe('ai-summary', () => {
  describe('normalizeAISummaryPayload', () => {
    it('should keep only the SDK sections rendered for the initiator', () => {
      const result = normalizeAISummaryPayload(
        {
          ...aiSummaryFixtures.initiatingMidCall.typedSections,
          sections: {
            ...aiSummaryFixtures.initiatingMidCall.typedSections.sections,
            nextSteps: 'Not an initiator section',
          },
        },
        'initiator'
      );

      expect(contentOf(result)).toEqual({
        sections: {
          reasonForTransferOrConsult: 'Customer needs billing help.',
          additionalContext: 'Invoice discrepancy is the active topic.',
          keyActionsTaken: 'Verified account and checked invoice.',
        },
      });
    });

    it('should fall back to non-blank summaryText when no declared section has a value', () => {
      const result = normalizeAISummaryPayload(
        {
          conversationId: 'interaction-main-1',
          sections: {reasonForTransferOrConsult: '  '},
          summaryText: '  Plain text with original bytes.  ',
        },
        'initiator'
      );

      expect(contentOf(result)).toEqual({summaryText: '  Plain text with original bytes.  '});
    });

    it('should accept plain and structured post-call summaries and keep the resolution separate', () => {
      expect(contentOf(normalizeAISummaryPayload(aiSummaryFixtures.postCall.plainText, 'post-call'))).toHaveProperty(
        'summaryText'
      );

      const present = contentOf(normalizeAISummaryPayload(aiSummaryFixtures.postCall.resolutionPresent, 'post-call'));
      expect(present.resolution).toBe('Correction approved');
      expect(Object.keys(present.sections ?? {})).toEqual(['initialContactReason', 'nextSteps']);

      for (const payload of [
        aiSummaryFixtures.postCall.resolutionAbsent,
        aiSummaryFixtures.postCall.resolutionEmptyBoundary,
      ]) {
        expect(contentOf(normalizeAISummaryPayload(payload, 'post-call'))).not.toHaveProperty('resolution');
      }
    });

    it('should report card-only initiator and post-call payloads as unsupported', () => {
      expect(normalizeAISummaryPayload(aiSummaryFixtures.initiatingMidCall.cardOnlyUnsupported, 'initiator')).toBe(
        'unsupported'
      );
      expect(normalizeAISummaryPayload(aiSummaryFixtures.postCall.cardOnlyUnsupported, 'post-call')).toBe(
        'unsupported'
      );
    });

    it('should keep the receiver card for display and SDK text for feedback', () => {
      expect(contentOf(normalizeAISummaryPayload(aiSummaryFixtures.receivingMidCall.adaptiveCard, 'receiver'))).toEqual(
        {
          adaptiveCard: aiSummaryFixtures.receivingMidCall.adaptiveCard.adaptiveCard,
          summaryText: aiSummaryFixtures.receivingMidCall.adaptiveCard.summaryText,
        }
      );
      expect(normalizeAISummaryPayload(aiSummaryFixtures.receivingMidCall.typedOnlyUnsupported, 'receiver')).toBe(
        'unsupported'
      );
      expect(normalizeAISummaryPayload(aiSummaryFixtures.initiatingMidCall.plainText, 'receiver')).toBe('unsupported');
    });

    it('should report empty SDK summaries as failures', () => {
      const failed = 'failed';

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
      expect(getAISummarySurface(entryWith({summaryText: 'Summary'}, {status: 'loading'}))).toBe('content');
      expect(getAISummarySurface({...newAISummaryEntry(), status: 'error', error: 'failed'})).toBe('generic-error');
      expect(getAISummarySurface({...newAISummaryEntry(), status: 'error', error: 'unsupported'})).toBe('unavailable');
    });
  });

  describe('editAISummaryContent', () => {
    it('should apply a text edit and mark the summary edited without changing its revision', () => {
      const entry = entryWith({summaryText: 'Original'});

      expect(editAISummaryContent(entry, 'summaryText', 'Edited')).toEqual({
        ...entry,
        content: {summaryText: 'Edited'},
        edited: true,
      });
    });

    it('should edit only the matching section', () => {
      const entry = entryWith(contentOf(normalizeAISummaryPayload(aiSummaryFixtures.postCall.structured, 'post-call')));
      const edited = editAISummaryContent(entry, 'nextSteps', 'Call back Friday.');

      expect(edited).toMatchObject({revision: 1, edited: true});
      expect(edited?.content?.sections).toEqual({...entry.content?.sections, nextSteps: 'Call back Friday.'});
    });

    it('should preserve blank sections alongside populated ones so an agent can fill them', () => {
      const entry = entryWith(
        contentOf(
          normalizeAISummaryPayload(
            {conversationId: 'interaction-main-1', sections: {initialContactReason: 'Billing inquiry', nextSteps: ''}},
            'post-call'
          )
        )
      );

      expect(entry.content?.sections).toEqual({initialContactReason: 'Billing inquiry', nextSteps: ''});
      expect(editAISummaryContent(entry, 'nextSteps', 'Email the corrected invoice.')).toMatchObject({
        content: {sections: {initialContactReason: 'Billing inquiry', nextSteps: 'Email the corrected invoice.'}},
        edited: true,
      });
    });

    it('should accept an unchanged value as a no-op and reject fields the content does not have', () => {
      const text = entryWith({summaryText: 'Original'});
      const sections = entryWith({sections: {additionalContext: 'Context'}});

      expect(editAISummaryContent(text, 'summaryText', 'Original')).toBe(text);
      expect(editAISummaryContent(text, 'additionalContext', 'x')).toBeUndefined();
      expect(editAISummaryContent(sections, 'summaryText', 'x')).toBeUndefined();
      expect(editAISummaryContent(sections, 'nextSteps', 'x')).toBeUndefined();
      expect(editAISummaryContent({...newAISummaryEntry(), status: 'ready'}, 'summaryText', 'x')).toBeUndefined();
    });
  });

  describe('response composition', () => {
    it('should report only changed mid-call sections with feedback, the edit flag and copies', () => {
      const content = contentOf(
        normalizeAISummaryPayload(aiSummaryFixtures.initiatingMidCall.typedSections, 'initiator')
      );
      const entry = entryWith(content, {copied: 2, feedback: 'thumbs_up'});
      const edited = editAISummaryContent(entry, 'additionalContext', 'Invoice correction requested.');

      expect(composeAISummaryResponse(edited)).toEqual({
        summary: {additionalContext: 'Invoice correction requested.'},
        feedback: 'thumbs_up',
        state: 'DEFAULT',
        numberOfTimesViewed: 1,
        numberOfTimesEdited: 1,
        numberOfTimesCopied: 2,
        summaryReceived: true,
      });
    });

    it('should compose the receiving agent response from SDK text without flattening the card', () => {
      const entry = entryWith(
        contentOf(normalizeAISummaryPayload(aiSummaryFixtures.receivingMidCall.adaptiveCard, 'receiver'))
      );

      expect(composeAISummaryResponse(entry)).toMatchObject({
        summary: aiSummaryFixtures.receivingMidCall.adaptiveCard.summaryText,
        feedback: 'none',
      });
    });

    it('should send empty text when a receiver card has no SDK summaryText', () => {
      const entry = entryWith({adaptiveCard: aiSummaryFixtures.receivingMidCall.adaptiveCard.adaptiveCard});

      expect(composeAISummaryResponse(entry)).toMatchObject({summary: '', summaryReceived: true, state: 'DEFAULT'});
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

      expect(composeAISummaryResponse({...newAISummaryEntry(), status: 'error', error: 'failed'})).toEqual(notReceived);
      expect(composeAISummaryResponse({...newAISummaryEntry(), status: 'loading'})).toEqual({
        ...notReceived,
        state: 'IGNORED',
      });
      expect(composeAISummaryResponse(undefined)).toEqual({...notReceived, state: 'IGNORED'});
    });

    it('should always compose the post-call response with the wrap-up code', () => {
      const entry = entryWith({summaryText: 'Resolved billing issue.'}, {feedback: 'thumbs_down'});

      expect(composeAISummaryResponse(entry, 'aux-billing')).toEqual({
        summary: 'Resolved billing issue.',
        feedback: 'thumbs_down',
        state: 'DEFAULT',
        numberOfTimesViewed: 1,
        numberOfTimesEdited: 0,
        numberOfTimesCopied: 0,
        summaryReceived: true,
        wrapUpCode: 'aux-billing',
      });
      expect(composeAISummaryResponse(undefined, 'aux-billing')).toMatchObject({
        summary: '',
        state: 'IGNORED',
        wrapUpCode: 'aux-billing',
      });
    });
  });
});
