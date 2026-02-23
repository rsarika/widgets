import {test} from '@playwright/test';
import createConferenceTransferSwitchTests from '../tests/conference-transfer-switch-test.spec';

const createConferenceTransferAndSwitchTests = () => createConferenceTransferSwitchTests('transfer-switch');

test.describe('Conference Transfer and Switch Tests', createConferenceTransferAndSwitchTests);
