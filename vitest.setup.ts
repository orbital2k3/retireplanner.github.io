import { vi } from 'vitest';
import { PINNED_NOW } from './src/engine/__regression__/snapshotUtil';

// Every test starts on a pinned "today" (Jan 1, so year 1 is a whole year). The engine prorates year-1
// growth and contributions by the real date, which would otherwise move every year-1 number daily.
// Tests of the proration itself pass `asOf` to runProjection or set their own system time.
// Only Date is faked, so timers the optimizer relies on keep working.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(PINNED_NOW));
