import {aiSummaryFixtures} from '../../test-fixtures/src/aiSummaryFixtures';
import {composeAISummaryResponse, getAISummarySurface} from '../src/ai-summary';
import type {AISummaryEntry} from '../src/store.types';
import type {AISummary} from '@webex/contact-center';

const entryWith = (content?: Partial<AISummary>, overrides: Partial<AISummaryEntry> = {}): AISummaryEntry => ({
  status: content ? 'ready' : 'loading',
  revision: content ? 1 : 0,
  copied: 0,
  edited: false,
  feedback: 'none',
  content: content ? {conversationId: 'interaction-main-1', ...content} : undefined,
  originalSections: content?.sections ? {...content.sections} : undefined,
  ...overrides,
});

describe('ai-summary', () => {
  describe('getAISummarySurface', () => {
    it('should derive the surface from request state while keeping received content visible during a refresh', () => {
      expect(getAISummarySurface(undefined)).toBe('omitted');
      expect(getAISummarySurface(entryWith())).toBe('generating');
      expect(getAISummarySurface(entryWith(undefined, {status: 'error'}))).toBe('generic-error');
      expect(getAISummarySurface(entryWith({summaryText: 'Summary'}, {status: 'loading'}))).toBe('content');
      expect(getAISummarySurface(entryWith({summaryText: 'Summary'}, {status: 'error'}))).toBe('content');
    });

    it('should use the SDK transcript availability flag without interpreting the payload format', () => {
      expect(getAISummarySurface(entryWith({areTranscriptsAvailable: false}))).toBe('unavailable');
      expect(getAISummarySurface(entryWith(aiSummaryFixtures.postCall.cardOnlyUnsupported))).toBe('content');
      expect(getAISummarySurface(entryWith({sections: {nextSteps: ''}, summaryText: '  '}))).toBe('content');
    });
  });

  describe('response composition', () => {
    it('should report only changed mid-call sections with feedback, the edit flag and copies', () => {
      const entry = entryWith(aiSummaryFixtures.initiatingMidCall.typedSections, {copied: 2, feedback: 'thumbs_up'});
      const edited: AISummaryEntry = {
        ...entry,
        content: {
          ...aiSummaryFixtures.initiatingMidCall.typedSections,
          sections: {...entry.content?.sections, additionalContext: 'Invoice correction requested.'},
        },
        edited: true,
      };

      expect(composeAISummaryResponse(edited, 'initiator')).toEqual({
        summary: {additionalContext: 'Invoice correction requested.'},
        feedback: 'thumbs_up',
        state: 'DEFAULT',
        numberOfTimesViewed: 1,
        numberOfTimesEdited: 1,
        numberOfTimesCopied: 2,
        summaryReceived: true,
      });
    });

    it('should use receiver SDK text even when the payload also contains sections and a card', () => {
      const entry = entryWith(aiSummaryFixtures.receivingMidCall.adaptiveCard);

      expect(composeAISummaryResponse(entry, 'receiver')).toMatchObject({
        summary: aiSummaryFixtures.receivingMidCall.adaptiveCard.summaryText,
        feedback: 'none',
      });
    });

    it('should send empty text when a receiver card has no SDK summaryText', () => {
      const entry = entryWith({adaptiveCard: aiSummaryFixtures.receivingMidCall.adaptiveCard.adaptiveCard});

      expect(composeAISummaryResponse(entry, 'receiver')).toMatchObject({
        summary: '',
        summaryReceived: true,
        state: 'DEFAULT',
      });
    });

    it('should report a failed request as not received and a pending one as ignored', () => {
      const notReceived = {
        summary: '',
        feedback: 'none',
        state: 'NOT_RECEIVED',
        numberOfTimesViewed: 0,
        numberOfTimesEdited: 0,
        numberOfTimesCopied: 0,
        summaryReceived: false,
      };

      expect(composeAISummaryResponse(entryWith(undefined, {status: 'error'}), 'initiator')).toEqual(notReceived);
      expect(composeAISummaryResponse(entryWith(), 'initiator')).toEqual({...notReceived, state: 'IGNORED'});
      expect(composeAISummaryResponse(undefined, 'initiator')).toEqual({...notReceived, state: 'IGNORED'});
    });

    it('should include the wrap-up code in the post-call response', () => {
      const entry = entryWith({summaryText: 'Resolved billing issue.'}, {feedback: 'thumbs_down'});

      expect(composeAISummaryResponse(entry, 'post-call', 'aux-billing')).toEqual({
        summary: 'Resolved billing issue.',
        feedback: 'thumbs_down',
        state: 'DEFAULT',
        numberOfTimesViewed: 1,
        numberOfTimesEdited: 0,
        numberOfTimesCopied: 0,
        summaryReceived: true,
        wrapUpCode: 'aux-billing',
      });
      expect(composeAISummaryResponse(undefined, 'post-call', 'aux-billing')).toMatchObject({
        summary: '',
        state: 'IGNORED',
        wrapUpCode: 'aux-billing',
      });
    });
  });
});
