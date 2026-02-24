import {test} from '@playwright/test';
import createConferenceTransferSwitchTests from '../tests/conference-transfer-switch-test.spec';

const createConferenceBalancedSet8Tests = () => createConferenceTransferSwitchTests('balanced-set8');

test.describe('Conference Balanced SET_8 Tests', createConferenceBalancedSet8Tests);
