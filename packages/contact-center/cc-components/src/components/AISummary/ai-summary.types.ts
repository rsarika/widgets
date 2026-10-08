import type {RefObject, TextareaHTMLAttributes} from 'react';
import type {AISummaryEntry, AISummaryFeedback, AISummarySections, getAISummarySurface} from '@webex/cc-store';

export type AISummaryPresentationState = Exclude<ReturnType<typeof getAISummarySurface>, 'omitted'>;

export type AISummaryEditorProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & {
  value: string;
};

type AISummaryFeedbackHandler = (feedback: Exclude<AISummaryFeedback, 'none'>, expectedRevision: number) => void;

type AISummaryBaseProps = {
  state: AISummaryPresentationState;
  requestPending?: boolean;
  controlsDisabled?: boolean;
  selectedFeedback?: AISummaryFeedback;
  containingPanelFocusTarget: RefObject<HTMLElement | null>;
};

type AISummaryFocusFallbackProps = {
  containingPanelFocusTarget: RefObject<HTMLElement | null>;
};

type AISummaryEditableActions = {
  content: NonNullable<AISummaryEntry['content']>;
  contentRevision: number;
  onEdit: (key: keyof AISummarySections | 'summaryText', value: string, expectedRevision: number) => boolean;
  onCopy: (expectedRevision: number) => boolean;
  onFeedback: AISummaryFeedbackHandler;
};

export type AISummaryMidCallInitiatorProps = AISummaryBaseProps &
  AISummaryEditableActions & {
    mode: 'mid-call-initiator';
    onRetry?: never;
  };

export type AISummaryMidCallReceiverReadyProps = AISummaryFocusFallbackProps & {
  mode: 'mid-call-receiver';
  state: 'content';
  requestPending?: boolean;
  controlsDisabled?: boolean;
  selectedFeedback?: AISummaryFeedback;
  contentRevision: number;
  getReceiverCopyText: () => string;
  onCopy: (expectedRevision: number) => boolean;
  onFeedback: AISummaryFeedbackHandler;
  content?: never;
  onEdit?: never;
  onRetry?: never;
};

export type AISummaryMidCallReceiverNonReadyProps = AISummaryFocusFallbackProps & {
  mode: 'mid-call-receiver';
  state: Exclude<AISummaryPresentationState, 'content'>;
  requestPending?: never;
  controlsDisabled?: never;
  selectedFeedback?: never;
  contentRevision?: never;
  getReceiverCopyText?: never;
  onCopy?: never;
  onFeedback?: never;
  content?: never;
  onEdit?: never;
  onRetry?: never;
};

export type AISummaryMidCallReceiverProps = AISummaryMidCallReceiverReadyProps | AISummaryMidCallReceiverNonReadyProps;

export type AISummaryPostCallProps = AISummaryBaseProps &
  AISummaryEditableActions & {
    mode: 'post-call';
    onRetry: () => Promise<void>;
    getReceiverCopyText?: never;
  };

export type AISummaryProps = AISummaryMidCallInitiatorProps | AISummaryMidCallReceiverProps | AISummaryPostCallProps;
