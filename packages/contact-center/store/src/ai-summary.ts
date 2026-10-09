import type {AISummaryEntry, AISummaryRole} from './store.types';
import type {AISummary, AISummaryResponse, AISummarySections} from '@webex/contact-center';

type AISummaryContent = NonNullable<AISummaryEntry['content']>;

const MID_CALL_SECTION_KEYS: ReadonlyArray<keyof AISummarySections> = [
  'reasonForTransferOrConsult',
  'additionalContext',
  'keyActionsTaken',
];
const POST_CALL_SECTION_KEYS: ReadonlyArray<keyof AISummarySections> = [
  'initialContactReason',
  'additionalContactReasons',
  'additionalContext',
  'keyActionsTaken',
  'nextSteps',
];

export const newAISummaryEntry = (): AISummaryEntry => ({
  status: 'loading',
  revision: 0,
  copied: 0,
  edited: false,
  feedback: 'none',
});

const hasText = (value?: string): boolean => Boolean(value?.trim());

/**
 * Keeps the receiver card for display and SDK text for feedback; otherwise the role's sections with a
 * `summaryText` fallback. Returns the reason when there is nothing to render.
 */
export const normalizeAISummaryPayload = (
  summary: AISummary,
  role: AISummaryRole
): AISummaryContent | NonNullable<AISummaryEntry['error']> => {
  if (role === 'receiver') {
    return summary.adaptiveCard
      ? {adaptiveCard: summary.adaptiveCard, summaryText: summary.summaryText}
      : 'unsupported';
  }

  if (summary.sections) {
    const sections: AISummarySections = {};
    const keys = role === 'post-call' ? POST_CALL_SECTION_KEYS : MID_CALL_SECTION_KEYS;
    for (const key of keys) {
      const value = summary.sections[key];
      if (value !== undefined) {
        sections[key] = value;
      }
    }
    if (Object.values(sections).some(hasText)) {
      return role === 'post-call' && hasText(summary.resolution)
        ? {sections, resolution: summary.resolution}
        : {sections};
    }
  }

  if (summary.summaryText !== undefined) {
    return hasText(summary.summaryText) ? {summaryText: summary.summaryText} : 'failed';
  }

  return summary.adaptiveCard ? 'unsupported' : 'failed';
};

/** What a summary location shows for an entry. */
export const getAISummarySurface = (
  entry?: AISummaryEntry
): 'omitted' | 'generating' | 'unavailable' | 'generic-error' | 'content' => {
  if (entry?.content) {
    return 'content';
  }
  if (entry?.status === 'loading') {
    return 'generating';
  }
  if (entry?.status === 'error') {
    return entry.error === 'unsupported' ? 'unavailable' : 'generic-error';
  }
  return 'omitted';
};

/**
 * Applies an edit to the entry's text or one of its sections. Returns the same entry when the value is
 * unchanged, and undefined when the field cannot be edited. Edits keep the revision: it only tracks which
 * summary was shown.
 */
export const editAISummaryContent = (
  entry: AISummaryEntry,
  key: keyof AISummarySections | 'summaryText',
  value: string
): AISummaryEntry | undefined => {
  const {content} = entry;
  const currentValue = key === 'summaryText' ? content?.summaryText : content?.sections?.[key];
  if (currentValue === undefined) {
    return undefined;
  }
  if (currentValue === value) {
    return entry;
  }
  return {
    ...entry,
    content:
      key === 'summaryText'
        ? {...content, summaryText: value}
        : {...content, sections: {...content?.sections, [key]: value}},
    edited: true,
  };
};

/** Like Desktop, structured feedback sends only edits, including a cleared section's empty string. */
const summaryOf = (entry?: AISummaryEntry): AISummaryResponse['summary'] => {
  const {sections, summaryText} = entry?.content ?? {};
  if (!sections) {
    return summaryText ?? '';
  }
  const modified: AISummarySections = {};
  for (const key of Object.keys(sections) as Array<keyof AISummarySections>) {
    if (sections[key] !== entry?.originalSections?.[key]) {
      modified[key] = sections[key];
    }
  }
  return modified;
};

// Like Agent Desktop: a received summary counts as viewed once and edits as a single flag. Without content the
// response says whether the summary never arrived (the request failed) or the agent acted before it did.
/** Composes a summary response, with a wrap-up code for the final post-call response. */
export const composeAISummaryResponse = (entry?: AISummaryEntry, wrapUpCode?: string): AISummaryResponse => {
  const received = Boolean(entry?.content);
  return {
    summary: summaryOf(entry),
    feedback: entry?.feedback ?? 'none',
    state: received ? 'DEFAULT' : entry?.status === 'error' ? 'NOT_RECEIVED' : 'IGNORED',
    numberOfTimesViewed: received ? 1 : 0,
    numberOfTimesEdited: entry?.edited ? 1 : 0,
    numberOfTimesCopied: entry?.copied ?? 0,
    summaryReceived: received,
    ...(wrapUpCode === undefined ? {} : {wrapUpCode}),
  };
};
