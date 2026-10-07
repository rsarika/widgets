import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {runInAction} from 'mobx';
import {AIAssistant} from '../../src';
import * as helper from '../../src/helper';
import store from '@webex/cc-store';
import type {AISummaryEntry} from '@webex/cc-store';
import '@testing-library/jest-dom';

jest.mock('@webex/cc-store', () => {
  const {observable} = jest.requireActual('mobx');
  const storeMock = {
    cc: {
      apiAIAssistant: {
        getRealTimeAssistance: jest.fn(),
        sendRealTimeAssistanceUserAction: jest.fn(),
      },
    },
    currentTask: {data: {interactionId: 'interaction-1'}},
    agentId: 'agent-1',
    agentProfile: {},
    featureFlags: {isSuggestedResponsesEnabled: true},
    realTimeAssist: {},
    aiSummaries: {},
    onErrorCallback: undefined,
    clearRealTimeAssist: jest.fn(),
    recordAISummaryCopied: jest.fn(),
    setMidCallSummaryFeedback: jest.fn(),
  };

  return {
    __esModule: true,
    getAISummarySurface: jest.requireActual('../../../store/src/ai-summary').getAISummarySurface,
    default: observable.object(storeMock, {
      cc: observable.ref,
      currentTask: observable.ref,
      agentProfile: observable.ref,
      featureFlags: observable.ref,
      realTimeAssist: observable.ref,
      aiSummaries: observable.ref,
      onErrorCallback: observable.ref,
      clearRealTimeAssist: false,
      recordAISummaryCopied: false,
      setMidCallSummaryFeedback: false,
    }),
  };
});

type StoreMock = {
  cc: {
    apiAIAssistant: {
      getRealTimeAssistance: jest.Mock;
      sendRealTimeAssistanceUserAction: jest.Mock;
    };
  };
  currentTask?: {data: {interactionId: string}};
  agentId: string;
  agentProfile: Record<string, unknown>;
  featureFlags: {isSuggestedResponsesEnabled: boolean};
  realTimeAssist: Record<string, unknown>;
  aiSummaries: Record<string, {receiver?: AISummaryEntry}>;
  onErrorCallback?: jest.Mock;
  clearRealTimeAssist: jest.Mock;
  recordAISummaryCopied: jest.Mock;
  setMidCallSummaryFeedback: jest.Mock;
};
const storeMock = store as unknown as StoreMock;

const receiverEntry = (overrides: Partial<AISummaryEntry> = {}): AISummaryEntry => ({
  status: 'ready',
  revision: 7,
  copied: 0,
  edited: false,
  feedback: 'none',
  actionType: 'TRANSFER',
  content: {
    type: 'card',
    adaptiveCard: {
      type: 'AdaptiveCard',
      version: '1.5',
      body: [{type: 'TextBlock', text: 'Receiver summary'}],
    },
  },
  ...overrides,
});

const receiverErrorEntry = (error: AISummaryEntry['error']): AISummaryEntry =>
  receiverEntry({status: 'error', error, content: undefined});

const setReceiverEntry = (receiver?: AISummaryEntry): void => {
  runInAction(() => {
    storeMock.aiSummaries = receiver ? {'interaction-1': {receiver}} : {};
  });
};

const deferred = <T,>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return {promise, resolve};
};

describe('AIAssistant widget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText: jest.fn().mockResolvedValue(undefined)},
    });
    storeMock.currentTask = {data: {interactionId: 'interaction-1'}};
    storeMock.agentProfile = {};
    storeMock.featureFlags = {isSuggestedResponsesEnabled: true};
    storeMock.realTimeAssist = {};
    storeMock.aiSummaries = {};
    storeMock.onErrorCallback = undefined;
    storeMock.recordAISummaryCopied.mockReturnValue(true);
    storeMock.cc.apiAIAssistant.sendRealTimeAssistanceUserAction.mockResolvedValue(undefined);
    storeMock.setMidCallSummaryFeedback.mockResolvedValue({outcome: 'confirmed'});
  });

  it('renders launcher when chrome is closed', () => {
    render(<AIAssistant />);
    expect(screen.getByTestId('ai-assistant:launcher')).toBeInTheDocument();
  });

  it('offers the launcher and the landing page before an interaction starts', () => {
    storeMock.currentTask = undefined;
    render(<AIAssistant />);

    fireEvent.click(screen.getByTestId('ai-assistant:launcher'));

    expect(screen.getByTestId('ai-assistant:landing')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-assistant:empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-assistant:footer')).not.toBeInTheDocument();
  });

  it('offers the launcher and the landing page when the feature is disabled', () => {
    storeMock.featureFlags = {isSuggestedResponsesEnabled: false};
    render(<AIAssistant />);

    fireEvent.click(screen.getByTestId('ai-assistant:launcher'));

    expect(screen.getByTestId('ai-assistant:landing')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-assistant:empty')).not.toBeInTheDocument();
  });

  it('renders RealTimeAssist inside the shared assistant panel', async () => {
    render(<AIAssistant />);

    fireEvent.click(screen.getByTestId('ai-assistant:launcher'));

    expect(screen.getByRole('dialog', {name: 'Cisco AI Assistant'})).toBeInTheDocument();
    expect(screen.getByTestId('ai-assistant:empty')).toBeInTheDocument();
    expect(within(screen.getByTestId('ai-assistant:body')).queryByTestId('ai-assistant:context-form')).toBeNull();

    fireEvent.click(screen.getByTestId('ai-assistant:get-suggestions'));

    expect(
      await within(screen.getByTestId('ai-assistant:body')).findByTestId('ai-assistant:context-form')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('ai-assistant:footer')).queryByTestId('ai-assistant:context-form')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-assistant:disclaimer')).toHaveTextContent(
      'I can make mistakes, so check my responses.'
    );
  });

  it('passes through className to root', () => {
    const {container} = render(<AIAssistant className="my-host-class" />);
    expect(container.querySelector('.my-host-class')).toBeInTheDocument();
  });

  it('should omit the View summary trigger until a receiver summary arrives for the current interaction', () => {
    runInAction(() => {
      storeMock.aiSummaries = {'other-interaction': {receiver: receiverEntry()}};
    });
    render(<AIAssistant />);
    expect(screen.queryByTestId('ai-assistant:view-summary')).not.toBeInTheDocument();
  });

  it('re-renders the receiver summary branch when the observable surface changes', async () => {
    setReceiverEntry(receiverErrorEntry('unsupported'));
    render(<AIAssistant />);

    fireEvent.click(screen.getByTestId('ai-assistant:view-summary'));
    expect(screen.getByTestId('ai-summary:unavailable')).toBeInTheDocument();

    setReceiverEntry(receiverErrorEntry('failed'));

    await waitFor(() => expect(screen.getByTestId('ai-summary:error')).toBeInTheDocument());
    expect(screen.queryByTestId('ai-summary:unavailable')).not.toBeInTheDocument();
  });

  it('should open the receiver summary from the View summary trigger', async () => {
    setReceiverEntry(receiverEntry());
    render(<AIAssistant />);

    fireEvent.click(screen.getByTestId('ai-assistant:view-summary'));

    expect(await screen.findByTestId('ai-assistant:receiver-summary')).toBeInTheDocument();
  });

  it('opens a receiver summary even when Real-time Assist is disabled', async () => {
    storeMock.featureFlags = {isSuggestedResponsesEnabled: false};
    setReceiverEntry(receiverEntry());
    render(<AIAssistant />);

    fireEvent.click(screen.getByTestId('ai-assistant:view-summary'));

    expect(await screen.findByTestId('ai-assistant:receiver-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-assistant:landing')).not.toBeInTheDocument();
  });

  it('routes receiver copy and feedback through the store with the current revision and action type', async () => {
    setReceiverEntry(receiverEntry());
    render(<AIAssistant />);

    fireEvent.click(screen.getByTestId('ai-assistant:view-summary'));
    fireEvent.click(await screen.findByRole('button', {name: 'Copy Summary'}));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(storeMock.recordAISummaryCopied).toHaveBeenCalledWith('receiver', 7, storeMock.currentTask);

    fireEvent.click(screen.getByRole('button', {name: 'This is helpful'}));

    await waitFor(() =>
      expect(storeMock.setMidCallSummaryFeedback).toHaveBeenCalledWith(
        'receiver',
        'like',
        'TRANSFER',
        7,
        storeMock.currentTask
      )
    );
  });

  it('projects receiver feedback pending state as disabled controls without painting a selection', async () => {
    setReceiverEntry(receiverEntry({feedbackPending: true}));
    render(<AIAssistant />);

    fireEvent.click(screen.getByTestId('ai-assistant:view-summary'));

    const like = await screen.findByRole('button', {name: 'This is helpful'});
    expect(like).toBeDisabled();
    expect(like).toHaveAttribute('aria-pressed', 'false');
  });

  it('replaces receiver feedback projections only after the store confirms the selection', async () => {
    const feedbackSend = deferred<{outcome: 'confirmed'}>();
    setReceiverEntry(receiverEntry());
    storeMock.setMidCallSummaryFeedback.mockImplementationOnce(() => {
      setReceiverEntry(receiverEntry({feedbackPending: true}));
      return feedbackSend.promise;
    });
    render(<AIAssistant />);

    fireEvent.click(screen.getByTestId('ai-assistant:view-summary'));
    const like = await screen.findByRole('button', {name: 'This is helpful'});
    fireEvent.click(like);

    await waitFor(() => expect(like).toBeDisabled());
    expect(like).toHaveAttribute('aria-pressed', 'false');

    feedbackSend.resolve({outcome: 'confirmed'});
    setReceiverEntry(receiverEntry({feedback: 'like'}));

    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'This is helpful'})).toHaveAttribute('aria-pressed', 'true')
    );
  });

  it('routes errors thrown in the hook to store.onErrorCallback', () => {
    const onErrorCallback = jest.fn();
    storeMock.onErrorCallback = onErrorCallback;
    jest.spyOn(helper, 'useAiAssistant').mockImplementation(() => {
      throw new Error('Boom');
    });

    const {container} = render(<AIAssistant />);
    expect(container.firstChild).toBeNull();
    expect(onErrorCallback).toHaveBeenCalledWith('AIAssistant', expect.any(Error));
  });
});
