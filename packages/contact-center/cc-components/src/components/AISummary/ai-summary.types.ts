import type {RefObject, TextareaHTMLAttributes} from 'react';
import type {AISummaryEntry, AISummaryFeedback, AISummarySections, getAISummarySurface} from '@webex/cc-store';

export type AISummaryPresentationState = Exclude<ReturnType<typeof getAISummarySurface>, 'omitted'>;

export type AISummaryEditorProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & {
  value: string;
};

type AISummaryBaseProps = {
  state: AISummaryPresentationState;
  requestPending?: boolean;
  controlsDisabled?: boolean;
  selectedFeedback?: AISummaryFeedback;
  containingPanelFocusTarget: RefObject<HTMLElement | null>;
};

type AISummaryActions = {
  contentRevision: number;
  onCopy: (expectedRevision: number) => boolean;
  onFeedback: (feedback: Exclude<AISummaryFeedback, 'none'>, expectedRevision: number) => void;
};

type AISummaryEditableActions = AISummaryActions & {
  content?: AISummaryEntry['content'];
  onEdit: (key: keyof AISummarySections | 'summaryText', value: string, expectedRevision: number) => boolean;
};

export type AISummaryMidCallInitiatorProps = AISummaryBaseProps &
  AISummaryEditableActions & {
    mode: 'mid-call-initiator';
    onRetry?: never;
  };

export type AISummaryMidCallReceiverProps = AISummaryBaseProps & {
  mode: 'mid-call-receiver';
  content?: never;
  onEdit?: never;
  onRetry?: never;
} & (
    | (AISummaryActions & {
        state: 'content';
        getReceiverCopyText: () => string;
      })
    | {
        state: Exclude<AISummaryPresentationState, 'content'>;
        contentRevision?: never;
        getReceiverCopyText?: never;
        onCopy?: never;
        onFeedback?: never;
      }
  );

export type AISummaryPostCallProps = AISummaryBaseProps &
  AISummaryEditableActions & {
    mode: 'post-call';
    onRetry: () => Promise<void>;
    getReceiverCopyText?: never;
  };

export type AISummaryProps = AISummaryMidCallInitiatorProps | AISummaryMidCallReceiverProps | AISummaryPostCallProps;
