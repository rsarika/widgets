import {test} from '@playwright/test';
import createConferenceTransferSwitchTests from '../tests/conference-transfer-switch-test.spec';

test.describe('Conference Transfer and Switch Tests', () => createConferenceTransferSwitchTests('transfer-switch'));
