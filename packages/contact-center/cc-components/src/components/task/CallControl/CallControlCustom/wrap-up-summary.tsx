import React, {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {RadioGroupNext as RadioGroup, TextInput} from '@momentum-ui/react-collaboration';
import {Icon} from '@momentum-design/components/dist/react';
import AISummary, {AI_SUMMARY_MESSAGES} from '../../../AISummary';
import {CLEAR_SEARCH, WRAP_UP_INTERACTION} from '../../constants';
import {WrapUpSummaryProps, WrapUpSummaryReason} from '../../task.types';
import './wrap-up-summary.styles.scss';

const useReactId = (React as typeof React & {useId: () => string}).useId;

const reasonMatchesQuery = (reason: WrapUpSummaryReason, query: string): boolean =>
  reason.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

const WrapUpSummary: React.FC<WrapUpSummaryProps> = ({
  reasons,
  summary,
  selectedReasonId,
  completionPending = false,
  onReasonChange,
  onComplete,
}) => {
  const headingId = useReactId();
  const [query, setQuery] = useState('');
  const wrapUpPanelRef = useRef<HTMLElement | null>(null);
  const summaryFocusedControlRef = useRef<HTMLElement | null>(null);
  const previousSummaryVisibleRef = useRef(false);
  const selectedReason = reasons.find((reason) => reason.id === selectedReasonId);
  const filteredReasons = useMemo(
    () => reasons.filter((reason) => reasonMatchesQuery(reason, query)),
    [query, reasons]
  );
  const summaryVisible = Boolean(summary && summary.state !== 'omitted');

  const clearSummaryFocusSnapshot = () => {
    summaryFocusedControlRef.current = null;
  };

  const restoreSummaryRemovalFocus = () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body && activeElement.isConnected) {
      clearSummaryFocusSnapshot();
      return;
    }
    const focusedSummaryControl = summaryFocusedControlRef.current;
    if (focusedSummaryControl && !focusedSummaryControl.isConnected) {
      wrapUpPanelRef.current?.focus();
    }
    clearSummaryFocusSnapshot();
  };

  useLayoutEffect(() => {
    const previousSummaryVisible = previousSummaryVisibleRef.current;
    previousSummaryVisibleRef.current = summaryVisible;
    if (previousSummaryVisible && !summaryVisible) {
      restoreSummaryRemovalFocus();
    }
  }, [summaryVisible]);

  const handleSummaryFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement) {
      summaryFocusedControlRef.current = target;
    }
  };

  return (
    <section
      className="wrap-up-summary agent-popover-content"
      data-testid="wrap-up-summary"
      ref={wrapUpPanelRef}
      tabIndex={-1}
    >
      <div className="wrap-up-summary__scroll-content" data-testid="wrap-up-summary:scroll-content">
        <header className="wrap-up-summary__header">
          <h2 className="wrap-up-summary__eyebrow">{WRAP_UP_INTERACTION}</h2>
          <p className="wrap-up-summary__intro">{AI_SUMMARY_MESSAGES.postCall.instructions}</p>
        </header>
        <h3 className="wrap-up-summary__title" id={headingId}>
          {AI_SUMMARY_MESSAGES.postCall.chooseReason}
        </h3>
        <div className="wrap-up-summary__search-field">
          <Icon name="search-regular" className="wrap-up-summary__search-field-icon" aria-hidden="true" />
          <TextInput
            aria-label={AI_SUMMARY_MESSAGES.postCall.reasonSearchLabel}
            className="wrap-up-summary__search-control"
            inputClassName="wrap-up-summary__search"
            placeholder={AI_SUMMARY_MESSAGES.postCall.searchPlaceholder}
            value={query}
            isDisabled={completionPending}
            clearAriaLabel={CLEAR_SEARCH}
            onChange={setQuery}
          />
        </div>
        <div className="wrap-up-summary__reason-group" aria-disabled={completionPending ? 'true' : undefined}>
          <RadioGroup
            aria-labelledby={headingId}
            className="wrap-up-summary__reasons"
            isDisabled={completionPending}
            onChange={(reasonId) => {
              const reason = reasons.find((candidate) => candidate.id === reasonId);
              if (reason) {
                onReasonChange(reason);
              }
            }}
            options={filteredReasons.map((reason) => ({
              className: 'wrap-up-summary__reason',
              label: reason.name,
              value: reason.id,
            }))}
            value={selectedReason?.id ?? ''}
          />
          {filteredReasons.length === 0 ? (
            <p className="wrap-up-summary__empty">{AI_SUMMARY_MESSAGES.postCall.noReasonMatches}</p>
          ) : null}
        </div>
        {summary && summary.state !== 'omitted' ? (
          <div
            className={`wrap-up-summary__body${summary.state === 'content' ? ' wrap-up-summary__body--content' : ''}`}
            data-testid="wrap-up-summary:body"
            onFocusCapture={handleSummaryFocusCapture}
          >
            <AISummary
              mode="post-call"
              state={summary.state}
              content={summary.content}
              contentRevision={summary.contentRevision}
              selectedFeedback={summary.selectedFeedback}
              requestPending={summary.requestPending}
              // The final response is taken when completion starts, so later edits would not be submitted.
              controlsDisabled={completionPending}
              onEdit={summary.onEdit}
              onCopy={summary.onCopy}
              onFeedback={summary.onFeedback}
              onRetry={summary.onRetry}
              containingPanelFocusTarget={wrapUpPanelRef}
            />
          </div>
        ) : null}
      </div>
      <div className="wrap-up-summary__actions">
        {/* As in Agent Desktop, a summary that is still generating does not hold back wrap-up. */}
        <button
          type="button"
          className="wrap-up-summary__complete"
          disabled={!selectedReason || completionPending}
          aria-label={AI_SUMMARY_MESSAGES.postCall.completeAction}
          title={AI_SUMMARY_MESSAGES.postCall.completeAction}
          onClick={() => selectedReason && onComplete(selectedReason)}
        >
          {AI_SUMMARY_MESSAGES.postCall.completeAction}
        </button>
      </div>
    </section>
  );
};

export default WrapUpSummary;
