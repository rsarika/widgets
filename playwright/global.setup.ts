import {test as setup, Browser} from '@playwright/test';
import {oauthLogin} from './Utils/initUtils';
import {USER_SETS} from './test-data';
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env');

const normalizeEnvContent = (content: string) => content.replace(/\n{3,}/g, '\n\n');

const removeEnvKey = (content: string, key: string) => {
  const keyPattern = new RegExp(`^${key}=.*$\\n?`, 'm');
  return content.replace(keyPattern, '');
};

const upsertEnvKey = (key: string, value: string) => {
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  envContent = removeEnvKey(envContent, key);
  if (!envContent.endsWith('\n') && envContent.length > 0) envContent += '\n';
  envContent += `${key}=${value}\n`;

  fs.writeFileSync(envPath, normalizeEnvContent(envContent), 'utf8');
};

export const UpdateENVWithUserSets = () => {
  // Constants
  const DOMAIN = process.env.PW_SANDBOX;

  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Dynamically set environment variables for all user sets
  Object.keys(USER_SETS).forEach((setKey) => {
    const userSet = USER_SETS[setKey];

    // Set agent usernames and extensions - access agents through userSet.AGENTS
    Object.keys(userSet.AGENTS).forEach((agentKey) => {
      const agent = userSet.AGENTS[agentKey];

      // Remove existing lines for this agent if they exist
      const usernamePattern = new RegExp(`^${setKey}_${agentKey}_USERNAME=.*$\\n?`, 'm');
      const extensionPattern = new RegExp(`^${setKey}_${agentKey}_EXTENSION_NUMBER=.*$\\n?`, 'm');
      const namePattern = new RegExp(`^${setKey}_${agentKey}_NAME=.*$\\n?`, 'm');

      envContent = envContent.replace(usernamePattern, '');
      envContent = envContent.replace(extensionPattern, '');
      envContent = envContent.replace(namePattern, '');

      // Add new lines
      if (!envContent.endsWith('\n') && envContent.length > 0) envContent += '\n';
      envContent += `${setKey}_${agentKey}_USERNAME=${agent.username}@${DOMAIN}\n`;
      envContent += `${setKey}_${agentKey}_EXTENSION_NUMBER=${agent.extension}\n`;
      envContent += `${setKey}_${agentKey}_NAME=${agent.agentName || ''}\n`;
    });

    // Map to corresponding SET environment variables
    const dialPattern = new RegExp(`^${setKey}_ENTRY_POINT=.*$\\n?`, 'm');
    const emailPattern = new RegExp(`^${setKey}_EMAIL_ENTRY_POINT=.*$\\n?`, 'm');
    const queuePattern = new RegExp(`^${setKey}_QUEUE_NAME=.*$\\n?`, 'm');
    const chatPattern = new RegExp(`^${setKey}_CHAT_URL=.*$\\n?`, 'm');

    envContent = envContent.replace(dialPattern, '');
    envContent = envContent.replace(emailPattern, '');
    envContent = envContent.replace(queuePattern, '');
    envContent = envContent.replace(chatPattern, '');

    if (!envContent.endsWith('\n') && envContent.length > 0) envContent += '\n';
    envContent += `${setKey}_ENTRY_POINT=${userSet.ENTRY_POINT || ''}\n`;
    envContent += `${setKey}_EMAIL_ENTRY_POINT=${userSet.EMAIL_ENTRY_POINT || ''}\n`;
    envContent += `${setKey}_QUEUE_NAME=${userSet.QUEUE_NAME || ''}\n`;
    envContent += `${setKey}_CHAT_URL=${userSet.CHAT_URL || ''}\n`;
  });

  // Write the updated content back to .env file
  fs.writeFileSync(envPath, normalizeEnvContent(envContent), 'utf8');
};

const setupAccessTokenForSet = async (browser: Browser, setKey: string) => {
  const userSet = USER_SETS[setKey];

  for (const agentKey of Object.keys(userSet.AGENTS)) {
    const page = await browser.newPage();

    // Construct the OAuth agent ID directly
    const oauthAgentId = `${userSet.AGENTS[agentKey].username}@${process.env.PW_SANDBOX}`;

    await oauthLogin(page, oauthAgentId);

    await page.getByRole('textbox').click();
    const accessToken = await page.getByRole('textbox').inputValue();
    upsertEnvKey(`${setKey}_${agentKey}_ACCESS_TOKEN`, accessToken);

    await page.close();
  }
};

setup.describe('OAuth', () => {
  // .env writes happen per test, so keep setup tests serial to avoid write races.
  setup.describe.configure({mode: 'serial'});

  setup.beforeAll(() => {
    // Ensure set-scoped env keys are up to date before generating tokens.
    UpdateENVWithUserSets();
  });

  for (const setKey of Object.keys(USER_SETS)) {
    setup(`OAuth for ${setKey}`, async ({browser}) => {
      await setupAccessTokenForSet(browser, setKey);
    });
  }

  setup('OAuth for DIAL_NUMBER_LOGIN', async ({browser}) => {
    const dialNumberUsername = process.env.PW_DIAL_NUMBER_LOGIN_USERNAME;
    const dialNumberPassword = process.env.PW_DIAL_NUMBER_LOGIN_PASSWORD;

    setup.skip(!(dialNumberUsername && dialNumberPassword), 'Dial number login credentials are not configured');

    const page = await browser.newPage();
    await oauthLogin(page, dialNumberUsername as string, dialNumberPassword as string);
    await page.getByRole('textbox').click();
    const accessToken = await page.getByRole('textbox').inputValue();
    upsertEnvKey('DIAL_NUMBER_LOGIN_ACCESS_TOKEN', accessToken);
    await page.close();
  });
});
