import {test} from '@playwright/test';
import createConferenceTransferSwitchTests from '../tests/conference-transfer-switch-test.spec';

const createConferenceBalancedSet7Tests = () => createConferenceTransferSwitchTests('balanced-set7');

test.describe('Conference Balanced SET_7 Tests', createConferenceBalancedSet7Tests);
