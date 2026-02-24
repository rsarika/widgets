import {test} from '@playwright/test';
import createConferenceTransferSwitchTests from '../tests/conference-transfer-switch-test.spec';

const createConferenceBalancedSet9Tests = () => createConferenceTransferSwitchTests('balanced-set9');

test.describe('Conference Balanced SET_9 Tests', createConferenceBalancedSet9Tests);
