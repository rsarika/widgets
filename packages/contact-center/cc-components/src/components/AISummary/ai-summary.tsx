import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Icon} from '@momentum-design/components/dist/react';
import type {AISummaryEntry, AISummaryFeedback} from '@webex/cc-store';
import {AI_SUMMARY_MESSAGES, AI_SUMMARY_SECTION_ORDER} from './ai-summary.constants';
import {COPIED_FEEDBACK_MS} from '../AIAssistant/constants';
import type {AISummaryEditorProps, AISummaryProps} from './ai-summary.types';
import './ai-summary.styles.scss';

type DisplaySection = {key: (typeof AI_SUMMARY_SECTION_ORDER)[number]; value: string};

const FEEDBACK_BUTTONS = [
  {feedback: 'thumbs_up', icon: 'like', label: AI_SUMMARY_MESSAGES.like},
  {feedback: 'thumbs_down', icon: 'dislike', label: AI_SUMMARY_MESSAGES.dislike},
] as const;

type AISummaryTooltipControl = 'copy' | Exclude<AISummaryFeedback, 'none'>;

const useReactId = (React as typeof React & {useId: () => string}).useId;

const BULLETED_SECTION_KEYS = new Set<DisplaySection['key']>([
  'additionalContactReasons',
  'keyActionsTaken',
  'nextSteps',
]);

/** The summary's sections in display order, with the read-only post-call resolution among them. */
export const getDisplaySections = (content: NonNullable<AISummaryEntry['content']>): DisplaySection[] =>
  AI_SUMMARY_SECTION_ORDER.flatMap((key): DisplaySection[] => {
    if (key === 'resolution') {
      return content.resolution?.trim() ? [{key, value: content.resolution}] : [];
    }
    const value = content.sections?.[key];
    return value === undefined ? [] : [{key, value}];
  });

const flattenContentForCopy = (content: NonNullable<AISummaryEntry['content']>): string => {
  if (!content.sections) {
    return content.summaryText ?? '';
  }
  return getDisplaySections(content)
    .filter((section) => section.value.trim().length > 0)
    .map((section) => `${AI_SUMMARY_MESSAGES.sectionLabels[section.key]}: ${section.value}`)
    .join('\n\n');
};

const renderReadonlyValue = (section: DisplaySection, inline = false) => {
  const lines = section.value.split('\n').filter((line) => line.trim().length > 0);
  if (BULLETED_SECTION_KEYS.has(section.key) && lines.length > 1) {
    const List = inline ? 'span' : 'ul';
    const Item = inline ? 'span' : 'li';
    return (
      <List className="ai-summary__readonly-list" role={inline ? 'list' : undefined} dir="auto">
        {lines.map((line, index) => (
          <Item key={`${section.key}-${index}`} role={inline ? 'listitem' : undefined} dir="auto">
            {line.trim().replace(/^(?:\u2022|[-*])\s*/, '')}
          </Item>
        ))}
      </List>
    );
  }

  return (
    <span className="ai-summary__readonly-value" dir="auto">
      {section.value}
    </span>
  );
};

// Keep keyed, controlled edits inside one visual surface. Never parse edited labels
// back into SDK keys or introduce a second scrollbar inside the containing panel.
const SummaryEditor: React.FC<AISummaryEditorProps> = ({value, ...props}) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const editor = ref.current;
    if (!editor) return;
    const resize = () => {
      if (!editor.isConnected) return;
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
    };
    resize();
    void document.fonts?.ready.then(resize, () => undefined);
    document.fonts?.addEventListener('loadingdone', resize);
    let width = editor.clientWidth;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (editor.clientWidth !== width) {
              width = editor.clientWidth;
              resize();
            }
          });
    observer?.observe(editor);
    return () => {
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', resize);
    };
  }, [value]);
  return <textarea {...props} ref={ref} rows={1} value={value} />;
};

const getEnabledControls = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]')).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-disabled') !== 'true' &&
      element.tabIndex >= 0 &&
      element.isConnected
  );

// Display the structured document compactly; activate the original keyed native
// editor on click/keyboard activation. SDK values remain plain text and unchanged.
const SummarySectionEditor: React.FC<{
  section: DisplaySection;
  disabled: boolean;
  onChange: (value: string) => void;
  onEditorBlur: () => void;
}> = ({section, disabled, onChange, onEditorBlur}) => {
  const [editing, setEditing] = useState(false);
  const label = AI_SUMMARY_MESSAGES.sectionLabels[section.key];
  if (editing && !disabled) {
    return (
      <label className="ai-summary__section ai-summary__section--structured">
        <span className="ai-summary__label" dir="auto">
          {label}
        </span>
        <SummaryEditor
          className="ai-summary__textarea"
          dir="auto"
          value={section.value}
          autoFocus
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={() => {
            setEditing(false);
            onEditorBlur();
          }}
        />
      </label>
    );
  }
  return (
    <button
      type="button"
      className="ai-summary__section-preview"
      aria-label={AI_SUMMARY_MESSAGES.editSectionLabel(label)}
      aria-description={section.value}
      disabled={disabled}
      onClick={() => setEditing(true)}
    >
      <span className="ai-summary__label" dir="auto">
        {label}:
      </span>{' '}
      {renderReadonlyValue(section, true)}
    </button>
  );
};

const AISummary = (props: AISummaryProps): React.ReactElement => {
  const rootRef = useRef<HTMLDivElement>(null);
  const focusedControlRef = useRef<HTMLElement | null>(null);
  const successorRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [hoveredTooltip, setHoveredTooltip] = useState<AISummaryTooltipControl | null>(null);
  const [, scheduleFocusRestoration] = useState(0);
  const feedbackDescriptionId = `ai-summary-feedback-${useReactId()}`;

  const contentRevision = props.contentRevision;
  const disabled = Boolean(props.controlsDisabled || props.requestPending);
  const selectedFeedback = props.selectedFeedback ?? 'none';

  const clearFocusSnapshot = () => {
    focusedControlRef.current = null;
    successorRef.current = null;
  };

  const handleLocalControlRemoval = () => {
    scheduleFocusRestoration((revision) => revision + 1);
  };

  // A new summary starts without the previous copy confirmation.
  useEffect(() => {
    setCopied(false);
  }, [contentRevision]);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (hoveredTooltip === null) {
      return undefined;
    }
    const dismissTooltip = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setHoveredTooltip(null);
      }
    };
    // Hover does not move focus into the summary. Capture Escape at the document
    // while a tooltip is visible so the same dismissal works from any focus target.
    document.addEventListener('keydown', dismissTooltip, true);
    return () => document.removeEventListener('keydown', dismissTooltip, true);
  }, [hoveredTooltip]);

  useLayoutEffect(() => {
    const focused = focusedControlRef.current;
    if (!focused || focused.isConnected) {
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body && activeElement.isConnected) {
      clearFocusSnapshot();
      return;
    }
    const successor = successorRef.current;
    if (successor?.isConnected) {
      successor.focus();
      clearFocusSnapshot();
      return;
    }
    props.containingPanelFocusTarget.current?.focus();
    clearFocusSnapshot();
  });

  const handleFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const controls = rootRef.current ? getEnabledControls(rootRef.current) : [];
    const index = controls.indexOf(target);
    focusedControlRef.current = target;
    successorRef.current = index >= 0 ? (controls[index + 1] ?? null) : null;
  };

  const handleBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    const root = rootRef.current;
    if (
      relatedTarget instanceof HTMLElement &&
      relatedTarget !== document.body &&
      relatedTarget.isConnected &&
      root &&
      !root.contains(relatedTarget)
    ) {
      clearFocusSnapshot();
    }
  };

  const handleCopy = async () => {
    if (disabled || props.state !== 'content') {
      return;
    }
    setHoveredTooltip(null);
    setCopied(false);
    try {
      const text =
        props.mode === 'mid-call-receiver'
          ? props.getReceiverCopyText()
          : props.content
            ? flattenContentForCopy(props.content)
            : '';
      if (text.trim().length === 0) {
        return;
      }
      await navigator.clipboard.writeText(text);
    } catch {
      // Without copy text or clipboard access, the button shows no confirmation.
      return;
    }
    // The store rejects the copy when a newer summary replaced this one meanwhile.
    setCopied(props.onCopy(props.contentRevision));
  };

  const handleFeedback = (feedback: Exclude<AISummaryFeedback, 'none'>) => {
    if (!disabled && props.state === 'content') {
      props.onFeedback(feedback, props.contentRevision);
    }
  };

  const renderStatus = () => {
    if (props.state === 'generating') {
      return (
        <div className="ai-summary__status" data-testid="ai-summary:generating">
          <h3 className="ai-summary__status-title ai-summary__status-title--generating">
            {AI_SUMMARY_MESSAGES.generatingTitle}
          </h3>
          <p className="ai-summary__description">{AI_SUMMARY_MESSAGES.generatingDescription}</p>
          <span className="ai-summary__spinner" aria-hidden="true" />
        </div>
      );
    }
    if (props.state === 'unavailable') {
      return (
        <div className="ai-summary__status" data-testid="ai-summary:unavailable">
          <p className="ai-summary__description">{AI_SUMMARY_MESSAGES.unavailable}</p>
        </div>
      );
    }
    if (props.state === 'generic-error') {
      return (
        <div className="ai-summary__status" data-testid="ai-summary:error">
          <Icon name="error-legacy-regular" className="ai-summary__error-icon" aria-hidden="true" />
          <h3 className="ai-summary__status-title ai-summary__status-title--error">
            {AI_SUMMARY_MESSAGES.generationError}
          </h3>
          <p className="ai-summary__description">{AI_SUMMARY_MESSAGES.generationErrorDescription}</p>
          {props.mode === 'post-call' ? (
            <button
              className="ai-summary__button"
              type="button"
              disabled={disabled}
              onClick={() => void props.onRetry()}
            >
              <Icon name="refresh-regular" aria-hidden="true" />
              {AI_SUMMARY_MESSAGES.retry}
            </button>
          ) : null}
        </div>
      );
    }
    return null;
  };

  const renderContent = () => {
    if (props.state !== 'content' || props.mode === 'mid-call-receiver' || !props.content) {
      return null;
    }
    if (!props.content.sections) {
      return (
        <div className="ai-summary__content" data-testid="ai-summary:content">
          <label className="ai-summary__section">
            <span className="ai-summary__sr-only">{AI_SUMMARY_MESSAGES.plainSummary}</span>
            <SummaryEditor
              className="ai-summary__textarea"
              dir="auto"
              value={props.content.summaryText ?? ''}
              disabled={disabled}
              onChange={(event) => props.onEdit('summaryText', event.currentTarget.value, props.contentRevision)}
            />
          </label>
        </div>
      );
    }
    return (
      <div className="ai-summary__content" data-testid="ai-summary:content">
        {getDisplaySections(props.content).map((section) => {
          const {key} = section;
          return key !== 'resolution' ? (
            <SummarySectionEditor
              key={key}
              section={section}
              disabled={disabled}
              onChange={(value) => props.onEdit(key, value, props.contentRevision)}
              onEditorBlur={handleLocalControlRemoval}
            />
          ) : (
            <div className="ai-summary__section ai-summary__section--structured" key={section.key}>
              <div className="ai-summary__readonly">
                <span className="ai-summary__label" dir="auto">
                  {AI_SUMMARY_MESSAGES.sectionLabels[section.key]}
                </span>
                {renderReadonlyValue(section)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Post-call feedback is only submitted with the final response after wrap-up.
  const feedbackDescription =
    props.mode === 'post-call' && selectedFeedback !== 'none'
      ? AI_SUMMARY_MESSAGES.feedback.pendingSubmission
      : undefined;

  const showActions = props.state === 'content';
  const showSummaryHeading = props.mode === 'post-call' && props.state === 'content';
  const copyLabel = copied ? AI_SUMMARY_MESSAGES.copiedSummary : AI_SUMMARY_MESSAGES.copySummary;
  const renderTooltip = (control: AISummaryTooltipControl, label: string) =>
    hoveredTooltip === control ? (
      <span className="ai-summary__tooltip" role="tooltip">
        {label}
      </span>
    ) : null;
  const getActionClassName = (control: AISummaryTooltipControl, extraClassName?: string) =>
    ['ai-summary__action', hoveredTooltip === control ? 'ai-summary__action--tooltip-open' : undefined, extraClassName]
      .filter(Boolean)
      .join(' ');
  const handleActionMouseEnter = (control: AISummaryTooltipControl) => {
    // Confirmation changes the copy button width and can retrigger pointer entry.
    if (!disabled && !(control === 'copy' && copied)) {
      setHoveredTooltip(control);
    }
  };
  const handleActionMouseLeave = (control: AISummaryTooltipControl) => {
    if (hoveredTooltip === control) {
      setHoveredTooltip(null);
    }
  };

  return (
    <section
      className="ai-summary"
      data-testid={`ai-summary:${props.mode}`}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      ref={rootRef}
    >
      {renderStatus()}
      {showSummaryHeading ? (
        <div className="ai-summary__summary-heading">
          <Icon name="sparkle-filled" className="ai-summary__summary-sparkle" aria-hidden="true" />
          <span>{AI_SUMMARY_MESSAGES.postCall.summaryHeading}</span>
          <Icon name="info-circle-filled" className="ai-summary__summary-info" aria-hidden="true" />
        </div>
      ) : null}
      <div className={showActions ? 'ai-summary__editor-surface' : undefined} data-testid="ai-summary:editor-surface">
        {renderContent()}
        {showActions ? (
          <div className="ai-summary__actions" data-testid="ai-summary:actions">
            <span
              className={getActionClassName('copy')}
              onMouseEnter={() => handleActionMouseEnter('copy')}
              onMouseLeave={() => handleActionMouseLeave('copy')}
            >
              <button
                className={`ai-summary__button ai-summary__copy-button${
                  copied ? ' ai-summary__copy-button--confirmed' : ''
                }`}
                type="button"
                disabled={disabled}
                onFocus={() => setHoveredTooltip('copy')}
                onBlur={() => {
                  setHoveredTooltip(null);
                  setCopied(false);
                }}
                onClick={() => void handleCopy()}
                aria-label={AI_SUMMARY_MESSAGES.copySummary}
              >
                <Icon name={copied ? 'check-bold' : 'copy-regular'} aria-hidden="true" />
                <span className="ai-summary__sr-only">{copyLabel}</span>
              </button>
              {renderTooltip('copy', AI_SUMMARY_MESSAGES.copySummary)}
            </span>
            {props.mode !== 'mid-call-receiver' ? (
              <>
                <span className="ai-summary__actions-spacer" />
                <span className="ai-summary__attribution">{AI_SUMMARY_MESSAGES.attribution}</span>
                <span className="ai-summary__action-separator" aria-hidden="true" />
              </>
            ) : null}
            <span className="ai-summary__feedback-group">
              {FEEDBACK_BUTTONS.map(({feedback, icon, label: feedbackLabel}) => {
                const selected = selectedFeedback === feedback;

                return (
                  <span
                    className={getActionClassName(feedback, 'ai-summary__feedback-action')}
                    key={feedback}
                    onMouseEnter={() => handleActionMouseEnter(feedback)}
                    onMouseLeave={() => handleActionMouseLeave(feedback)}
                  >
                    <button
                      className={`ai-summary__button ai-summary__feedback-button${
                        selected ? ' ai-summary__feedback-button--selected' : ''
                      }`}
                      type="button"
                      disabled={disabled}
                      onFocus={() => setHoveredTooltip(feedback)}
                      onBlur={() => setHoveredTooltip(null)}
                      onClick={() => handleFeedback(feedback)}
                      aria-label={feedbackLabel}
                      aria-pressed={selected}
                      aria-describedby={feedbackDescription ? feedbackDescriptionId : undefined}
                    >
                      <Icon name={`${icon}-${selected ? 'filled' : 'regular'}`} aria-hidden="true" />
                    </button>
                    {renderTooltip(feedback, feedbackLabel)}
                  </span>
                );
              })}
            </span>
          </div>
        ) : null}
      </div>
      {feedbackDescription ? (
        <p className="ai-summary__feedback-status" id={feedbackDescriptionId}>
          {feedbackDescription}
        </p>
      ) : null}
    </section>
  );
};

export default AISummary;
