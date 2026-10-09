import type {AISummaryEntry} from './store.types';

/** What a summary location shows for an entry. */
export const getAISummarySurface = (
  entry?: AISummaryEntry
): 'omitted' | 'generating' | 'unavailable' | 'generic-error' | 'content' => {
  if (entry?.content) {
    return entry.content.areTranscriptsAvailable === false ? 'unavailable' : 'content';
  }
  if (entry?.status === 'loading') {
    return 'generating';
  }
  if (entry?.status === 'error') {
    return 'generic-error';
  }
  return 'omitted';
};
