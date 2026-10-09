import {aiSummaryFixtures} from '../../test-fixtures/src/aiSummaryFixtures';
import {getAISummarySurface} from '../src/ai-summary';
import type {AISummaryEntry} from '../src/store.types';
import type {AISummary} from '@webex/contact-center';

const entryWith = (content?: Partial<AISummary>, overrides: Partial<AISummaryEntry> = {}): AISummaryEntry => ({
  status: content ? 'ready' : 'loading',
  revision: content ? 1 : 0,
  response: {
    summary: '',
    feedback: 'none',
    state: content ? 'DEFAULT' : 'IGNORED',
    numberOfTimesViewed: content ? 1 : 0,
    numberOfTimesEdited: 0,
    numberOfTimesCopied: 0,
    summaryReceived: Boolean(content),
  },
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
});
