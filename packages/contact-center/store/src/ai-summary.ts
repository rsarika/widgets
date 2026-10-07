import type {
  AISummaryContent,
  AISummaryEditableField,
  AISummaryEntry,
  AISummaryRole,
  AISummarySection,
  AISummarySectionKey,
  AISummarySurface,
} from './store.types';
import type {AISummaryResponse, AISummarySections, AISummaryState} from '@webex/contact-center';

type UnknownRecord = Record<string, unknown>;

/** A summary payload normalized for one role. */
export type AISummaryResult =
  | {kind: 'success'; content: AISummaryContent}
  | {kind: 'error'; error: NonNullable<AISummaryEntry['error']>};

const MID_CALL_SECTION_KEYS = new Set<AISummarySectionKey>([
  'reasonForTransferOrConsult',
  'additionalContext',
  'keyActionsTaken',
]);
const POST_CALL_SECTION_KEYS = new Set<AISummarySectionKey>([
  'initialContactReason',
  'additionalContactReasons',
  'additionalContext',
  'keyActionsTaken',
  'nextSteps',
]);

export const newAISummaryEntry = (): AISummaryEntry => ({
  status: 'loading',
  revision: 0,
  copied: 0,
  edited: false,
  feedback: 'none',
});

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getString = (record: UnknownRecord, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const normalizeSectionsRecord = (
  rawSections: unknown,
  allowedKeys: ReadonlySet<AISummarySectionKey>
): AISummarySection[] | 'invalid' => {
  if (!isRecord(rawSections)) {
    return 'invalid';
  }
  const sections: AISummarySection[] = [];
  for (const [key, value] of Object.entries(rawSections)) {
    if (!allowedKeys.has(key as AISummarySectionKey)) {
      continue;
    }
    if (typeof value !== 'string') {
      return 'invalid';
    }
    if (value.trim().length === 0) {
      continue;
    }
    sections.push({
      key: key as AISummarySectionKey,
      value,
      editable: true,
    });
  }
  return sections;
};

/**
 * Reads the part of an SDK summary a role renders: the adaptive card for the receiving agent, otherwise
 * typed sections with a `summaryText` fallback.
 */
export const normalizeAISummaryPayload = (raw: unknown, role: AISummaryRole): AISummaryResult => {
  if (!isRecord(raw)) {
    return {kind: 'error', error: 'failed'};
  }

  if (role === 'receiver') {
    return isRecord(raw.adaptiveCard)
      ? {kind: 'success', content: {type: 'card', adaptiveCard: raw.adaptiveCard}}
      : {kind: 'error', error: 'unsupported'};
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'sections')) {
    const sections = normalizeSectionsRecord(
      raw.sections,
      role === 'post-call' ? POST_CALL_SECTION_KEYS : MID_CALL_SECTION_KEYS
    );
    if (sections === 'invalid') {
      return {kind: 'error', error: 'failed'};
    }
    if (sections.length > 0) {
      const resolution = role === 'post-call' ? getString(raw, 'resolution') : undefined;
      return {kind: 'success', content: {type: 'sections', sections, resolution}};
    }
  }

  if (typeof raw.summaryText === 'string') {
    return raw.summaryText.trim().length > 0
      ? {kind: 'success', content: {type: 'text', summaryText: raw.summaryText}}
      : {kind: 'error', error: 'failed'};
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'adaptiveCard')) {
    return {kind: 'error', error: 'unsupported'};
  }
  return {kind: 'error', error: 'failed'};
};

/** What a summary location shows for an entry. */
export const getAISummarySurface = (entry?: AISummaryEntry): AISummarySurface => {
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
  field: AISummaryEditableField
): AISummaryEntry | undefined => {
  const {content} = entry;
  let edited: AISummaryContent;
  if (content?.type === 'text' && field.key === 'summaryText') {
    if (content.summaryText === field.value) {
      return entry;
    }
    edited = {...content, summaryText: field.value};
  } else if (content?.type === 'sections' && field.key !== 'summaryText') {
    const section = content.sections.find((candidate) => candidate.key === field.key);
    if (!section) {
      return undefined;
    }
    if (section.value === field.value) {
      return entry;
    }
    edited = {
      ...content,
      sections: content.sections.map((candidate) =>
        candidate === section ? {...candidate, value: field.value} : candidate
      ),
    };
  } else {
    return undefined;
  }
  return {...entry, content: edited, edited: true};
};

const SDK_FEEDBACK = {
  none: 'none',
  like: 'thumbs_up',
  dislike: 'thumbs_down',
} as const;

const composeSectionResponse = (
  sections: AISummarySection[],
  allowedKeys: ReadonlySet<AISummarySectionKey>
): AISummarySections => {
  const response: AISummarySections = {};
  for (const section of sections) {
    if (allowedKeys.has(section.key)) {
      response[section.key] = section.value;
    }
  }
  return response;
};

const CARD_TEXT_KEYS = new Set(['text', 'title', 'value']);

/** Flattens the visible text of an adaptive card, for the receiving agent's feedback response. */
export const projectAISummaryCardText = (adaptiveCard: unknown): string => {
  const fragments: string[] = [];
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === 'string') {
      if (key && CARD_TEXT_KEYS.has(key) && value.trim().length > 0) {
        fragments.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry));
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    for (const [entryKey, entryValue] of Object.entries(value)) {
      visit(entryValue, entryKey);
    }
  };
  visit(adaptiveCard);
  return fragments.join('\n');
};

// Like Agent Desktop: a received summary counts as viewed once and edits as a single flag. Without content the
// response says whether the summary never arrived (the request failed) or the agent acted before it did.
const buildAISummaryResponse = (
  entry: AISummaryEntry | undefined,
  summary: string | AISummarySections
): AISummaryResponse => {
  const received = Boolean(entry?.content);
  let state: AISummaryState = 'IGNORED';
  if (received) {
    state = 'DEFAULT';
  } else if (entry?.status === 'error') {
    state = 'NOT_RECEIVED';
  }
  return {
    summary,
    feedback: SDK_FEEDBACK[entry?.feedback ?? 'none'],
    state,
    numberOfTimesViewed: received ? 1 : 0,
    numberOfTimesEdited: entry?.edited ? 1 : 0,
    numberOfTimesCopied: entry?.copied ?? 0,
    summaryReceived: received,
  };
};

const summaryOf = (
  content: AISummaryContent | undefined,
  sectionKeys: ReadonlySet<AISummarySectionKey>
): string | AISummarySections => {
  if (content?.type === 'text') {
    return content.summaryText;
  }
  if (content?.type === 'card') {
    return projectAISummaryCardText(content.adaptiveCard);
  }
  return content?.type === 'sections' ? composeSectionResponse(content.sections, sectionKeys) : '';
};

/** Mid-call response for the consult/transfer about to start, or for receiver feedback. */
export const composeMidCallResponse = (entry?: AISummaryEntry): AISummaryResponse =>
  buildAISummaryResponse(entry, summaryOf(entry?.content, MID_CALL_SECTION_KEYS));

/** Final post-call response sent once after wrap-up. */
export const composePostCallResponse = (entry: AISummaryEntry | undefined, wrapUpCode: string): AISummaryResponse => ({
  ...buildAISummaryResponse(entry, summaryOf(entry?.content, POST_CALL_SECTION_KEYS)),
  wrapUpCode,
});
