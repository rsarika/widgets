import type {AISummaryEntry, AISummaryRole} from './store.types';
import type {AISummaryResponse, AISummarySections} from '@webex/contact-center';

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

// Like Agent Desktop: a received summary counts as viewed once and edits as a single flag. Without content the
// response says whether the summary never arrived (the request failed) or the agent acted before it did.
/** Composes a summary response, with a wrap-up code for the final post-call response. */
export const composeAISummaryResponse = (
  entry: AISummaryEntry | undefined,
  role: AISummaryRole,
  wrapUpCode?: string
): AISummaryResponse => {
  const {sections, summaryText} = entry?.content ?? {};
  let summary: AISummaryResponse['summary'] = summaryText ?? '';
  // Receivers report SDK text. Editable summaries report only changed sections, like Desktop.
  if (role !== 'receiver' && sections) {
    const modified: AISummarySections = {};
    for (const key of Object.keys(sections) as Array<keyof AISummarySections>) {
      if (sections[key] !== entry?.originalSections?.[key]) {
        modified[key] = sections[key];
      }
    }
    summary = modified;
  }
  const received = Boolean(entry?.content);
  return {
    summary,
    feedback: entry?.feedback ?? 'none',
    state: received ? 'DEFAULT' : entry?.status === 'error' ? 'NOT_RECEIVED' : 'IGNORED',
    numberOfTimesViewed: received ? 1 : 0,
    numberOfTimesEdited: entry?.edited ? 1 : 0,
    numberOfTimesCopied: entry?.copied ?? 0,
    summaryReceived: received,
    ...(wrapUpCode === undefined ? {} : {wrapUpCode}),
  };
};
