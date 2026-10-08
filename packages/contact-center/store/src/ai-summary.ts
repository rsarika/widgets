import type {AISummaryEntry, AISummaryRole} from './store.types';
import type {AISummaryResponse, AISummarySections, AISummaryState} from '@webex/contact-center';

type UnknownRecord = Record<string, unknown>;
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

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBlank = (value: unknown): boolean => typeof value !== 'string' || value.trim().length === 0;

/** Keeps the non-empty sections a role renders; undefined when a rendered section is not a string. */
const pickSections = (
  rawSections: unknown,
  keys: ReadonlyArray<keyof AISummarySections>
): AISummarySections | undefined => {
  if (!isRecord(rawSections)) {
    return undefined;
  }
  const sections: AISummarySections = {};
  for (const key of keys) {
    const value = rawSections[key];
    if (value !== undefined && typeof value !== 'string') {
      return undefined;
    }
    if (!isBlank(value)) {
      sections[key] = value as string;
    }
  }
  return sections;
};

/**
 * Reads the part of an SDK summary a role renders: the adaptive card for the receiving agent, otherwise the role's
 * sections with a `summaryText` fallback. Returns the reason when there is nothing to render.
 */
export const normalizeAISummaryPayload = (
  raw: unknown,
  role: AISummaryRole
): AISummaryContent | NonNullable<AISummaryEntry['error']> => {
  if (!isRecord(raw)) {
    return 'failed';
  }

  if (role === 'receiver') {
    return isRecord(raw.adaptiveCard) ? {adaptiveCard: raw.adaptiveCard} : 'unsupported';
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'sections')) {
    const sections = pickSections(raw.sections, role === 'post-call' ? POST_CALL_SECTION_KEYS : MID_CALL_SECTION_KEYS);
    if (!sections) {
      return 'failed';
    }
    if (Object.keys(sections).length > 0) {
      return role === 'post-call' && !isBlank(raw.resolution)
        ? {sections, resolution: raw.resolution as string}
        : {sections};
    }
  }

  if (typeof raw.summaryText === 'string') {
    return isBlank(raw.summaryText) ? 'failed' : {summaryText: raw.summaryText};
  }

  return Object.prototype.hasOwnProperty.call(raw, 'adaptiveCard') ? 'unsupported' : 'failed';
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
  let edited: AISummaryContent;
  if (key === 'summaryText') {
    if (content?.summaryText === undefined) {
      return undefined;
    }
    if (content.summaryText === value) {
      return entry;
    }
    edited = {...content, summaryText: value};
  } else {
    if (content?.sections?.[key] === undefined) {
      return undefined;
    }
    if (content.sections[key] === value) {
      return entry;
    }
    edited = {...content, sections: {...content.sections, [key]: value}};
  }
  return {...entry, content: edited, edited: true};
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

const summaryOf = (content: AISummaryContent | undefined): AISummaryResponse['summary'] => {
  if (content?.sections) {
    return content.sections;
  }
  if (content?.adaptiveCard) {
    return projectAISummaryCardText(content.adaptiveCard);
  }
  return content?.summaryText ?? '';
};

// Like Agent Desktop: a received summary counts as viewed once and edits as a single flag. Without content the
// response says whether the summary never arrived (the request failed) or the agent acted before it did.
const buildAISummaryResponse = (entry: AISummaryEntry | undefined): AISummaryResponse => {
  const received = Boolean(entry?.content);
  let state: AISummaryState = 'IGNORED';
  if (received) {
    state = 'DEFAULT';
  } else if (entry?.status === 'error') {
    state = 'NOT_RECEIVED';
  }
  return {
    summary: summaryOf(entry?.content),
    feedback: entry?.feedback ?? 'none',
    state,
    numberOfTimesViewed: received ? 1 : 0,
    numberOfTimesEdited: entry?.edited ? 1 : 0,
    numberOfTimesCopied: entry?.copied ?? 0,
    summaryReceived: received,
  };
};

/** Mid-call response for the consult/transfer about to start, or for receiver feedback. */
export const composeMidCallResponse = (entry?: AISummaryEntry): AISummaryResponse => buildAISummaryResponse(entry);

/** Final post-call response sent once after wrap-up. */
export const composePostCallResponse = (entry: AISummaryEntry | undefined, wrapUpCode: string): AISummaryResponse => ({
  ...buildAISummaryResponse(entry),
  wrapUpCode,
});
