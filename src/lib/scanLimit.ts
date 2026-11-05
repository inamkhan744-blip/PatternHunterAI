const STORAGE_KEY = "ph_scan_limit";
const FREE_DAILY_LIMIT = 3;

interface ScanLimitState {
  date: string;
  count: number;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function readState(): ScanLimitState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ScanLimitState;
      if (parsed.date === todayStr()) {
        return parsed;
      }
    }
  } catch {
    // ignore corrupt data
  }
  return { date: todayStr(), count: 0 };
}

function writeState(state: ScanLimitState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

export function getScanCount(): number {
  return readState().count;
}

export function getRemainingScans(): number {
  return Math.max(0, FREE_DAILY_LIMIT - readState().count);
}

export function incrementScanCount(): void {
  const state = readState();
  writeState({ date: state.date, count: state.count + 1 });
}

export function canScan(): boolean {
  return readState().count < FREE_DAILY_LIMIT;
}

export const FREE_LIMIT = FREE_DAILY_LIMIT;
