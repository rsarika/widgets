import {test} from '@playwright/test';
import createConferenceTransferSwitchTests from '../tests/conference-transfer-switch-test.spec';

const createConferenceMpcTests = () => createConferenceTransferSwitchTests('mpc');

test.describe('Conference MPC Tests', createConferenceMpcTests);
