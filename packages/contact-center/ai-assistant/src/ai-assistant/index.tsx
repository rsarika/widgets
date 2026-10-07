import React from 'react';
import store, {getAISummarySurface} from '@webex/cc-store';
import {observer} from 'mobx-react-lite';
import {ErrorBoundary} from 'react-error-boundary';

import {AIAssistantComponent} from '@webex/cc-components';
import {useAiAssistant, REAL_TIME_ASSIST_FLAG} from '../helper';
import {AIAssistantReceiverSummary, IAIAssistantProps} from '../ai-assistant.types';

const AIAssistantInternal: React.FunctionComponent<IAIAssistantProps> = observer((props) => {
  const {currentTask, agentId, agentProfile, featureFlags, realTimeAssist, aiSummaries} = store;
  const interactionId = currentTask?.data?.interactionId;
  const isFeatureEnabled = Boolean(featureFlags?.[REAL_TIME_ASSIST_FLAG]);
  const activeRealTimeAssist = interactionId ? realTimeAssist?.[interactionId] || [] : [];
  // The receiving agent's consult/transfer summary, pushed by the backend for the current interaction.
  const receiverEntry = interactionId ? aiSummaries?.[interactionId]?.receiver : undefined;
  const receiverSurface = getAISummarySurface(receiverEntry);
  const receiverBranchKey = `mid-call:receiver:${interactionId ?? 'none'}`;
  const receiverSummary: AIAssistantReceiverSummary | undefined =
    receiverSurface === 'content' && receiverEntry.content.type === 'card'
      ? {
          surface: 'content',
          branchKey: receiverBranchKey,
          content: receiverEntry.content,
          contentRevision: receiverEntry.revision,
          actionType: receiverEntry.actionType ?? 'TRANSFER',
          selectedFeedback: receiverEntry.feedback,
          midCallFeedbackPending: Boolean(receiverEntry.feedbackPending),
          controlsDisabled: Boolean(receiverEntry.feedbackPending),
          recordReceiverSummaryCopied: (expectedRevision: number) =>
            store.recordAISummaryCopied('receiver', expectedRevision, currentTask),
          setReceiverSummaryFeedback: (feedback, actionType, expectedRevision) =>
            store.setMidCallSummaryFeedback('receiver', feedback, actionType, expectedRevision, currentTask),
        }
      : receiverSurface === 'unavailable' || receiverSurface === 'generic-error'
        ? {surface: receiverSurface, branchKey: receiverBranchKey}
        : undefined;

  const hookProps = useAiAssistant({
    ...props,
    interactionId,
    agentId,
    isFeatureEnabled,
    realTimeAssist: activeRealTimeAssist,
    receiverSummary,
  });

  return (
    <AIAssistantComponent
      {...hookProps}
      isFeatureEnabled={isFeatureEnabled}
      hasActiveInteraction={Boolean(interactionId)}
      agentName={agentProfile?.agentName}
      logger={store.logger}
      className={props.className}
    />
  );
});

const AIAssistant: React.FunctionComponent<IAIAssistantProps> = (props) => (
  <ErrorBoundary
    fallbackRender={() => <></>}
    onError={(error: Error) => {
      if (store.onErrorCallback) store.onErrorCallback('AIAssistant', error);
    }}
  >
    <AIAssistantInternal {...props} />
  </ErrorBoundary>
);

export {AIAssistant};
