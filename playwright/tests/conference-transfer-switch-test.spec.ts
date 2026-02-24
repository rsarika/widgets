import {test, expect, Page} from '@playwright/test';
import {TestManager} from '../test-manager';
import {consultOrTransfer, cancelConsult} from '../Utils/advancedTaskControlUtils';
import {createCallTask, acceptIncomingTask} from '../Utils/incomingTaskUtils';
import {verifyCurrentState, getCurrentState} from '../Utils/userStateUtils';
import {waitForState} from '../Utils/helperUtils';
import {
  getRequiredEnvValue,
  setAgentState,
  ensureAgentsIdle,
  safeHandleStrayTasks,
  submitWrapupIfVisible,
  clickMergeWhenReady,
} from '../Utils/conferenceUtils';
import {ACCEPT_TASK_TIMEOUT, AWAIT_TIMEOUT, OPERATION_TIMEOUT, TASK_TYPES, USER_STATES} from '../constants';

export type ConferenceSuiteGroup = 'all' | 'mpc' | 'transfer-switch' | 'mpc-transfer' | 'switch';

export default function createConferenceTransferSwitchTests(group: ConferenceSuiteGroup = 'all') {
  let testManager: TestManager;

  const runMpc = group === 'all' || group === 'mpc' || group === 'mpc-transfer';
  const runTransfer = group === 'all' || group === 'mpc-transfer' || group === 'transfer-switch';
  const runSwitch = group === 'all' || group === 'switch' || group === 'transfer-switch';

  const getAgentNames = () => ({
    agent2Name: getRequiredEnvValue(`${testManager.projectName}_AGENT2_NAME`),
    agent3Name: getRequiredEnvValue(`${testManager.projectName}_AGENT3_NAME`),
  });

  const getEntryPoint = () => getRequiredEnvValue(`${testManager.projectName}_ENTRY_POINT`);

  const prepareInboundTarget = async (targetPage: Page, nonTargetPages: Page[]): Promise<void> => {
    await ensureAgentsIdle(nonTargetPages);
    await setAgentState(targetPage, USER_STATES.AVAILABLE);
  };

  const cleanupAllAgents = async (): Promise<void> => {
    await Promise.all([
      safeHandleStrayTasks(testManager.agent1Page),
      safeHandleStrayTasks(testManager.agent2Page),
      safeHandleStrayTasks(testManager.agent3Page),
      safeHandleStrayTasks(testManager.agent4Page),
    ]);
  };

  const createInboundAndAccept = async (targetPage: Page, nonTargetPages: Page[]): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await prepareInboundTarget(targetPage, nonTargetPages);
      await createCallTask(testManager.callerPage!, getEntryPoint());

      try {
        await acceptIncomingTask(targetPage, TASK_TYPES.CALL, ACCEPT_TASK_TIMEOUT);
        await waitForState(targetPage, USER_STATES.ENGAGED);
        await verifyCurrentState(targetPage, USER_STATES.ENGAGED);
        return;
      } catch (error) {
        if (attempt === 1) {
          throw error;
        }
        await Promise.all([
          safeHandleStrayTasks(testManager.agent1Page),
          safeHandleStrayTasks(testManager.agent2Page),
          safeHandleStrayTasks(testManager.agent3Page),
          safeHandleStrayTasks(testManager.agent4Page),
        ]);
        await expect(testManager.callerPage.locator('#destination')).toBeVisible({timeout: AWAIT_TIMEOUT});
      }
    }
  };

  const consultAgentWithRetry = async (initiatorPage: Page, targetName: string): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(initiatorPage.getByTestId('call-control:consult').first()).toBeVisible({
        timeout: ACCEPT_TASK_TIMEOUT,
      });
      try {
        await consultOrTransfer(initiatorPage, 'agent', 'consult', targetName);
        return;
      } catch (error) {
        if (attempt === 1) {
          throw error;
        }
        await expect(initiatorPage.getByTestId('call-control:consult').first()).toBeVisible({timeout: AWAIT_TIMEOUT});
      }
    }
  };

  const createConferenceA1A2 = async (): Promise<void> => {
    const {agent2Name} = getAgentNames();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await createInboundAndAccept(testManager.agent1Page, [
          testManager.agent2Page,
          testManager.agent3Page,
          testManager.agent4Page,
        ]);

        await ensureAgentsIdle([testManager.agent3Page, testManager.agent4Page]);
        await setAgentState(testManager.agent2Page, USER_STATES.AVAILABLE);

        await consultAgentWithRetry(testManager.agent1Page, agent2Name);
        await acceptIncomingTask(testManager.agent2Page, TASK_TYPES.CALL, ACCEPT_TASK_TIMEOUT);
        await waitForState(testManager.agent2Page, USER_STATES.ENGAGED);

        await clickMergeWhenReady(testManager.agent1Page);

        await expect(testManager.agent1Page.getByTestId('call-control:exit-conference').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
        await expect(testManager.agent2Page.getByTestId('call-control:exit-conference').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
        return;
      } catch (error) {
        if (attempt === 1) {
          throw error;
        }
        await cleanupAllAgents();
      }
    }
  };

  const createConferenceA1A2A3 = async (): Promise<void> => {
    const {agent3Name} = getAgentNames();

    await createConferenceA1A2();
    await ensureAgentsIdle([testManager.agent4Page]);
    await setAgentState(testManager.agent3Page, USER_STATES.AVAILABLE);

    await consultAgentWithRetry(testManager.agent1Page, agent3Name);
    await acceptIncomingTask(testManager.agent3Page, TASK_TYPES.CALL, ACCEPT_TASK_TIMEOUT);
    await waitForState(testManager.agent3Page, USER_STATES.ENGAGED);

    await clickMergeWhenReady(testManager.agent1Page);

    await expect(testManager.agent3Page.getByTestId('call-control:exit-conference').first()).toBeVisible({
      timeout: AWAIT_TIMEOUT,
    });
  };

  const startConsult = async (
    initiatorPage: Page,
    targetPage: Page,
    targetName: string,
    nonTargetPages: Page[]
  ): Promise<void> => {
    await ensureAgentsIdle(nonTargetPages);
    await setAgentState(targetPage, USER_STATES.AVAILABLE);
    await consultAgentWithRetry(initiatorPage, targetName);
    await acceptIncomingTask(targetPage, TASK_TYPES.CALL, ACCEPT_TASK_TIMEOUT);
    await waitForState(targetPage, USER_STATES.ENGAGED);
  };

  const transferConsultLeg = async (initiatorPage: Page): Promise<void> => {
    await expect(initiatorPage.getByTestId('transfer-consult-btn')).toBeVisible({timeout: AWAIT_TIMEOUT});
    await initiatorPage.getByTestId('transfer-consult-btn').click({timeout: AWAIT_TIMEOUT});
    await expect(initiatorPage.getByTestId('transfer-consult-btn')).toBeHidden({timeout: AWAIT_TIMEOUT});
  };

  const endCallAndWrapup = async (page: Page): Promise<void> => {
    await page.getByTestId('call-control:end-call').first().click({timeout: AWAIT_TIMEOUT});
    await completePostExitConferenceFlow(page);
  };

  const completePostExitConferenceFlow = async (page: Page): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < OPERATION_TIMEOUT) {
      const currentState = await getCurrentState(page).catch(() => '');
      if (currentState === USER_STATES.AVAILABLE) {
        return;
      }

      const wrapupVisible = await page
        .getByTestId('call-control:wrapup-button')
        .first()
        .isVisible()
        .catch(() => false);

      if (wrapupVisible) {
        await submitWrapupIfVisible(page);
      }

      await page.waitForTimeout(500);
    }

    await waitForState(page, USER_STATES.AVAILABLE, OPERATION_TIMEOUT);
  };

  const exitConferenceAndWaitForAvailable = async (page: Page): Promise<void> => {
    const exitButton = page.getByTestId('call-control:exit-conference').first();
    await expect(exitButton).toBeVisible({timeout: AWAIT_TIMEOUT});
    await expect(exitButton).toBeEnabled({timeout: AWAIT_TIMEOUT});
    await exitButton.click({timeout: AWAIT_TIMEOUT});
    await exitButton.waitFor({state: 'hidden', timeout: OPERATION_TIMEOUT}).catch(() => {});
    await completePostExitConferenceFlow(page);
  };

  test.beforeAll(async ({browser}, testInfo) => {
    testManager = new TestManager(testInfo.project.name);
    await testManager.setupForConferenceDesktop(browser);
  });

  test.beforeEach(async () => {
    await cleanupAllAgents();
  });

  if (runMpc) {
    test('CTS-MPC-01 should create conference (A1 + A2 + customer) in desktop mode', async () => {
      try {
        await createConferenceA1A2();
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-02 should allow participant exit while owner stays engaged', async () => {
      try {
        await createConferenceA1A2();
        await exitConferenceAndWaitForAvailable(testManager.agent2Page);
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
        await endCallAndWrapup(testManager.agent1Page);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-03 should keep conference active when owner exits and hand over to remaining participant', async () => {
      try {
        await createConferenceA1A2();
        await exitConferenceAndWaitForAvailable(testManager.agent1Page);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
        await endCallAndWrapup(testManager.agent2Page);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-04 should support 4-party conference path (A1 + A2 + A3 + customer)', async () => {
      test.setTimeout(180000);
      try {
        await createConferenceA1A2A3();
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-05 should keep owner conference controls visible after merge', async () => {
      try {
        await createConferenceA1A2();
        await expect(testManager.agent1Page.getByTestId('call-control:consult').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
        await expect(testManager.agent1Page.getByTestId('call-control:exit-conference').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-06 should end conference from owner and return all agents to idle states', async () => {
      try {
        await createConferenceA1A2();
        await endCallAndWrapup(testManager.agent1Page);
        await waitForState(testManager.agent2Page, USER_STATES.AVAILABLE);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-07 should allow third agent to exit and preserve conference on remaining agents', async () => {
      try {
        await createConferenceA1A2A3();
        await exitConferenceAndWaitForAvailable(testManager.agent3Page);
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-08 should preserve conference between A2 and A3 after A1 exits a 4-party flow', async () => {
      try {
        await createConferenceA1A2A3();
        await exitConferenceAndWaitForAvailable(testManager.agent1Page);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-09 should allow ownership handover agent to start consult and cancel it safely', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await exitConferenceAndWaitForAvailable(testManager.agent1Page);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
        await startConsult(testManager.agent2Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await cancelConsult(testManager.agent2Page);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-10 should keep conference stable after owner starts and cancels consult', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await startConsult(testManager.agent1Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await cancelConsult(testManager.agent1Page);
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-11 should re-merge consult leg into conference without breaking existing participants', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await startConsult(testManager.agent1Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await clickMergeWhenReady(testManager.agent1Page);
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-12 should allow post-handover participant to transfer consult leg to another agent', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await exitConferenceAndWaitForAvailable(testManager.agent1Page);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
        await startConsult(testManager.agent2Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await transferConsultLeg(testManager.agent2Page);
        await submitWrapupIfVisible(testManager.agent2Page);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-13 should keep 4-party conference active when A2 exits', async () => {
      try {
        await createConferenceA1A2A3();
        await exitConferenceAndWaitForAvailable(testManager.agent2Page);
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-14 should end 4-party conference from owner and clear all agent states', async () => {
      try {
        await createConferenceA1A2A3();
        await endCallAndWrapup(testManager.agent1Page);
        await waitForState(testManager.agent2Page, USER_STATES.AVAILABLE);
        await waitForState(testManager.agent3Page, USER_STATES.AVAILABLE);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-15 should keep consult and transfer controls available in 4-party conference', async () => {
      try {
        await createConferenceA1A2A3();
        await expect(testManager.agent1Page.getByTestId('call-control:consult').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
        await expect(testManager.agent1Page.getByTestId('call-control:exit-conference').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-MPC-16 should allow handover participant to end conference cleanly', async () => {
      try {
        await createConferenceA1A2();
        await exitConferenceAndWaitForAvailable(testManager.agent1Page);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
        await endCallAndWrapup(testManager.agent2Page);
      } finally {
        await cleanupAllAgents();
      }
    });
  }

  if (runTransfer) {
    test('CTS-TC-01 should transfer conference from owner to another agent', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await ensureAgentsIdle([testManager.agent4Page]);
        await setAgentState(testManager.agent3Page, USER_STATES.AVAILABLE);
        await consultOrTransfer(testManager.agent1Page, 'agent', 'consult', agent3Name);
        await acceptIncomingTask(testManager.agent3Page, TASK_TYPES.CALL, ACCEPT_TASK_TIMEOUT);
        await waitForState(testManager.agent3Page, USER_STATES.ENGAGED);
        await transferConsultLeg(testManager.agent1Page);
        await submitWrapupIfVisible(testManager.agent1Page);
        const agent1State = await getCurrentState(testManager.agent1Page);
        expect([USER_STATES.AVAILABLE, USER_STATES.MEETING]).toContain(agent1State);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-TC-02 should allow participant to consult-transfer after ownership handover', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await exitConferenceAndWaitForAvailable(testManager.agent1Page);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
        await expect(testManager.agent2Page.getByTestId('call-control:consult').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
        await ensureAgentsIdle([testManager.agent4Page]);
        await setAgentState(testManager.agent3Page, USER_STATES.AVAILABLE);
        await consultOrTransfer(testManager.agent2Page, 'agent', 'consult', agent3Name);
        await acceptIncomingTask(testManager.agent3Page, TASK_TYPES.CALL, ACCEPT_TASK_TIMEOUT);
        await waitForState(testManager.agent3Page, USER_STATES.ENGAGED);
        await transferConsultLeg(testManager.agent2Page);
        await submitWrapupIfVisible(testManager.agent2Page);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-TC-03 should complete transfer to target directly after consult accept', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await startConsult(testManager.agent1Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await transferConsultLeg(testManager.agent1Page);
        await submitWrapupIfVisible(testManager.agent1Page);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-TC-04 should keep transfer path stable after switch-to-main and switch-back', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await startConsult(testManager.agent1Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await expect(testManager.agent1Page.getByTestId('switchToMainCall-consult-btn')).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
        await testManager.agent1Page.getByTestId('switchToMainCall-consult-btn').click({timeout: AWAIT_TIMEOUT});
        await testManager.agent1Page
          .getByTestId('call-control:switch-to-consult')
          .first()
          .click({timeout: AWAIT_TIMEOUT});
        await transferConsultLeg(testManager.agent1Page);
        await submitWrapupIfVisible(testManager.agent1Page);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-TC-05 should transfer from handover participant after consult accept', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await exitConferenceAndWaitForAvailable(testManager.agent1Page);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
        await startConsult(testManager.agent2Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await transferConsultLeg(testManager.agent2Page);
        await submitWrapupIfVisible(testManager.agent2Page);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test.skip('CTS-SKIP-TC14 consult/transfer with external DN', async () => {});
    test.skip('CTS-SKIP-TC20 conference with 7 agents', async () => {});
    test.fixme('CTS-TODO-TC17 transfer fails when target cannot join main conference', async () => {});
    test.fixme('CTS-TODO-TC18 failure-path transfer scenario', async () => {});
    test.fixme('CTS-TODO-TC19 oldest participant ownership fallback', async () => {});
  }

  if (runSwitch) {
    test('CTS-SW-01 should switch from consult to main call and back in conference flow', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await startConsult(testManager.agent1Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await expect(testManager.agent1Page.getByTestId('switchToMainCall-consult-btn')).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
        await testManager.agent1Page.getByTestId('switchToMainCall-consult-btn').click({timeout: AWAIT_TIMEOUT});
        await expect(testManager.agent1Page.getByTestId('call-control:switch-to-consult').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
        await testManager.agent1Page
          .getByTestId('call-control:switch-to-consult')
          .first()
          .click({timeout: AWAIT_TIMEOUT});
        await expect(testManager.agent1Page.getByTestId('cancel-consult-btn')).toBeVisible({timeout: AWAIT_TIMEOUT});
        await cancelConsult(testManager.agent1Page);
        await expect(testManager.agent1Page.getByTestId('call-control:consult').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-SW-02 should switch to main and then cancel consult safely', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await startConsult(testManager.agent1Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await testManager.agent1Page.getByTestId('switchToMainCall-consult-btn').click({timeout: AWAIT_TIMEOUT});
        await testManager.agent1Page
          .getByTestId('call-control:switch-to-consult')
          .first()
          .click({timeout: AWAIT_TIMEOUT});
        await cancelConsult(testManager.agent1Page);
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
        await verifyCurrentState(testManager.agent2Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-SW-03 should support repeated switch toggles during consult leg', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await startConsult(testManager.agent1Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await testManager.agent1Page.getByTestId('switchToMainCall-consult-btn').click({timeout: AWAIT_TIMEOUT});
        await testManager.agent1Page
          .getByTestId('call-control:switch-to-consult')
          .first()
          .click({timeout: AWAIT_TIMEOUT});
        await testManager.agent1Page.getByTestId('switchToMainCall-consult-btn').click({timeout: AWAIT_TIMEOUT});
        await testManager.agent1Page
          .getByTestId('call-control:switch-to-consult')
          .first()
          .click({timeout: AWAIT_TIMEOUT});
        await cancelConsult(testManager.agent1Page);
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-SW-04 should keep transfer stable after consult-main switch cycle', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await startConsult(testManager.agent1Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await testManager.agent1Page.getByTestId('switchToMainCall-consult-btn').click({timeout: AWAIT_TIMEOUT});
        await testManager.agent1Page
          .getByTestId('call-control:switch-to-consult')
          .first()
          .click({timeout: AWAIT_TIMEOUT});
        await transferConsultLeg(testManager.agent1Page);
        await submitWrapupIfVisible(testManager.agent1Page);
        await verifyCurrentState(testManager.agent3Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });

    test('CTS-SW-05 should recover cleanly when consulted agent ends consult leg', async () => {
      const {agent3Name} = getAgentNames();
      try {
        await createConferenceA1A2();
        await startConsult(testManager.agent1Page, testManager.agent3Page, agent3Name, [testManager.agent4Page]);
        await cancelConsult(testManager.agent3Page);
        await expect(testManager.agent1Page.getByTestId('call-control:consult').first()).toBeVisible({
          timeout: AWAIT_TIMEOUT,
        });
        await verifyCurrentState(testManager.agent1Page, USER_STATES.ENGAGED);
      } finally {
        await cleanupAllAgents();
      }
    });
  }

  test.afterAll(async () => {
    await cleanupAllAgents();
    await testManager.cleanup();
  });
}
