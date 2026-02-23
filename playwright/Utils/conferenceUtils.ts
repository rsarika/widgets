import {expect, Page} from '@playwright/test';
import {changeUserState, verifyCurrentState} from './userStateUtils';
import {waitForState, handleStrayTasks} from './helperUtils';
import {submitWrapup} from './wrapupUtils';
import {AWAIT_TIMEOUT, USER_STATES, WRAPUP_REASONS} from '../constants';

export const getRequiredEnvValue = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export async function setAgentState(page: Page, state: string): Promise<void> {
  await changeUserState(page, state);
  await waitForState(page, state);
  await verifyCurrentState(page, state);
}

export async function ensureAgentsIdle(pages: Page[]): Promise<void> {
  for (const page of pages) {
    await setAgentState(page, USER_STATES.MEETING);
  }
}

export async function safeHandleStrayTasks(page: Page, timeout: number = 30000): Promise<void> {
  if (!page || page.isClosed()) {
    return;
  }
  await Promise.race([handleStrayTasks(page).catch(() => {}), page.waitForTimeout(timeout).catch(() => {})]);
}

export async function submitWrapupIfVisible(page: Page): Promise<void> {
  const wrapupVisible = await page
    .getByTestId('call-control:wrapup-button')
    .first()
    .isVisible()
    .catch(() => false);

  if (wrapupVisible) {
    await submitWrapup(page, WRAPUP_REASONS.SALE);
    await waitForState(page, USER_STATES.AVAILABLE).catch(() => {});
  }
}

export async function clickMergeWhenReady(ownerPage: Page): Promise<void> {
  const mergeButton = ownerPage.getByTestId('conference-consult-btn').first();
  await expect(mergeButton).toBeVisible({timeout: AWAIT_TIMEOUT});
  await expect(mergeButton).toBeEnabled({timeout: AWAIT_TIMEOUT});
  await mergeButton.click({timeout: AWAIT_TIMEOUT});
}
