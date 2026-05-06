// Pure forecasting functions. History = array of weekly demand numbers (oldest -> newest).

export type ForecastResult = {
  name: string;
  forecast: number[]; // length = horizon
  applicable: boolean;
  reason?: string;
};

export function movingAverage(history: number[], horizon = 13, window = 13): ForecastResult {
  const n = history.length;
  if (n < 2) return { name: "Moving Average", forecast: [], applicable: false, reason: "Not enough history" };
  const w = Math.min(window, n);
  const slice = history.slice(-w);
  const avg = slice.reduce((a, b) => a + b, 0) / w;
  return { name: "Moving Average", forecast: Array(horizon).fill(avg), applicable: true };
}

export function exponentialSmoothing(history: number[], horizon = 13, alpha = 0.3): ForecastResult {
  if (history.length < 2)
    return { name: "Exponential Smoothing", forecast: [], applicable: false, reason: "Not enough history" };
  let level = history[0];
  for (let i = 1; i < history.length; i++) level = alpha * history[i] + (1 - alpha) * level;
  return { name: "Exponential Smoothing", forecast: Array(horizon).fill(level), applicable: true };
}

// Croston's method for intermittent demand
export function croston(history: number[], horizon = 13, alpha = 0.1): ForecastResult {
  if (history.length < 2)
    return { name: "Croston", forecast: [], applicable: false, reason: "Not enough history" };
  const nonzero = history.filter((v) => v > 0);
  if (nonzero.length < 2)
    return { name: "Croston", forecast: Array(horizon).fill(0), applicable: true };

  let z = nonzero[0]; // demand size estimate
  let p = 1; // interval estimate
  let q = 1; // periods since last demand

  for (let i = 1; i < history.length; i++) {
    if (history[i] > 0) {
      z = alpha * history[i] + (1 - alpha) * z;
      p = alpha * q + (1 - alpha) * p;
      q = 1;
    } else {
      q += 1;
    }
  }
  const rate = p > 0 ? z / p : 0;
  return { name: "Croston", forecast: Array(horizon).fill(rate), applicable: true };
}

// Weighted MAPE on a holdout (actual vs forecast). Returns percent (0-100+).
export function wmape(actual: number[], forecast: number[]): number {
  const n = Math.min(actual.length, forecast.length);
  if (n === 0) return Infinity;
  let absErr = 0;
  let absSum = 0;
  for (let i = 0; i < n; i++) {
    absErr += Math.abs(actual[i] - forecast[i]);
    absSum += Math.abs(actual[i]);
  }
  if (absSum === 0) return absErr === 0 ? 0 : Infinity;
  return (absErr / absSum) * 100;
}

export type TournamentEntry = {
  name: string;
  wmape: number | null;
  applicable: boolean;
  reason?: string;
  forecast: number[];
  isWinner: boolean;
};

export function runTournament(
  weekly: number[],
  isIntermittent: boolean,
  horizon = 13,
  holdout = 8,
): { entries: TournamentEntry[]; winner: TournamentEntry | null } {
  const n = weekly.length;
  const splitAt = Math.max(0, n - holdout);
  const train = weekly.slice(0, splitAt);
  const test = weekly.slice(splitAt);

  const evalModel = (
    name: string,
    fn: (h: number[]) => ForecastResult,
  ): TournamentEntry => {
    const trainForecast = fn(train);
    const fullForecast = fn(weekly);
    if (!trainForecast.applicable || !fullForecast.applicable) {
      return {
        name,
        wmape: null,
        applicable: false,
        reason: trainForecast.reason ?? fullForecast.reason,
        forecast: [],
        isWinner: false,
      };
    }
    const err = test.length ? wmape(test, trainForecast.forecast.slice(0, test.length)) : Infinity;
    return {
      name,
      wmape: err,
      applicable: true,
      forecast: fullForecast.forecast,
      isWinner: false,
    };
  };

  const entries: TournamentEntry[] = [
    evalModel("Moving Average", (h) => movingAverage(h, horizon)),
    evalModel("Exponential Smoothing", (h) => exponentialSmoothing(h, horizon)),
    isIntermittent
      ? evalModel("Croston", (h) => croston(h, horizon))
      : {
          name: "Croston",
          wmape: null,
          applicable: false,
          reason: "Only for intermittent SKUs",
          forecast: [],
          isWinner: false,
        },
  ];

  const eligible = entries.filter((e) => e.applicable && e.wmape !== null && isFinite(e.wmape));
  let winner: TournamentEntry | null = null;
  if (eligible.length) {
    winner = eligible.reduce((best, cur) => (cur.wmape! < best.wmape! ? cur : best));
    winner.isWinner = true;
  }
  return { entries, winner };
}

// Aggregate sales rows into weekly buckets (ISO week start = Monday).
export function aggregateWeekly(
  rows: { sale_date: string; quantity: number }[],
  weeks: number,
  endDate = new Date(),
): { week: string; total: number }[] {
  const buckets: Record<string, number> = {};
  const startOfWeek = (d: Date) => {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const end = startOfWeek(endDate);
  const start = new Date(end);
  start.setDate(start.getDate() - 7 * (weeks - 1));
  for (let i = 0; i < weeks; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i * 7);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const r of rows) {
    const d = startOfWeek(new Date(r.sale_date));
    if (d < start || d > end) continue;
    const k = d.toISOString().slice(0, 10);
    buckets[k] = (buckets[k] ?? 0) + r.quantity;
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, total]) => ({ week, total }));
}
