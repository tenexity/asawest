// Pure forecasting functions. History = array of weekly demand numbers (oldest -> newest).

export type ForecastResult = {
  name: string;
  forecast: number[]; // length = horizon
  applicable: boolean;
  reason?: string;
};

// Helper: robust min/max clip so forecasts stay inside the historical envelope.
function envelope(history: number[]) {
  if (!history.length) return { lo: 0, hi: 0, mean: 0 };
  const sorted = [...history].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
  const lo = Math.max(0, q(0.05));
  const hi = q(0.95);
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  return { lo, hi, mean };
}

export function movingAverage(history: number[], horizon = 13, window = 13): ForecastResult {
  const n = history.length;
  if (n < 2) return { name: "Moving Average", forecast: [], applicable: false, reason: "Not enough history" };

  const { lo, hi, mean } = envelope(history);
  const trailing = history.slice(-Math.min(window, n));
  const trailingAvg = trailing.reduce((a, b) => a + b, 0) / trailing.length;

  // If we have at least a full year of history, produce a *smoothed*
  // seasonal-naive moving average: for each future week h, average the
  // same week-of-year (± a 2-week window) across all prior years, then
  // blend 50/50 with the trailing average. This gives the line a seasonal
  // shape without replaying last year's week-to-week noise.
  const season = 52;
  if (n >= season) {
    const forecast: number[] = [];
    for (let h = 1; h <= horizon; h++) {
      const centerOffset = (h - 1) % season;
      const samples: number[] = [];
      for (let dk = -2; dk <= 2; dk++) {
        const off = ((centerOffset + dk) % season + season) % season;
        for (let k = n - season + off; k >= 0; k -= season) {
          if (k >= 0 && k < n) samples.push(history[k]);
        }
      }
      const seasonal = samples.length
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : trailingAvg;
      const blended = 0.5 * seasonal + 0.5 * trailingAvg;
      forecast.push(Math.min(hi, Math.max(lo, blended)));
    }
    return { name: "Moving Average", forecast, applicable: true };
  }

  // Short history — classic trailing-window average, clipped to envelope.
  const avg = Math.min(hi, Math.max(lo, trailingAvg || mean));
  return { name: "Moving Average", forecast: Array(horizon).fill(avg), applicable: true };
}

// Damped Holt-Winters additive: level + damped trend + weekly seasonality.
// The damping factor (phi) prevents long-horizon extrapolation from
// dragging the forecast to zero when the recent-year trend is slightly
// negative. Seasonal learning (gamma) is deliberately low so the seasonal
// component doesn't chase week-to-week noise and blow the envelope.
export function exponentialSmoothing(
  history: number[],
  horizon = 13,
  alpha = 0.2,
  beta = 0.05,
  gamma = 0.15,
  season = 52,
  phi = 0.85,
): ForecastResult {
  const n = history.length;
  if (n < 4)
    return { name: "Exponential Smoothing", forecast: [], applicable: false, reason: "Not enough history" };

  const m = n >= season ? season : Math.max(4, Math.floor(n / 2));

  const seed = history.slice(0, m);
  let level = seed.reduce((a, b) => a + b, 0) / m;
  const lastCycle = history.slice(-m);
  const lastMean = lastCycle.reduce((a, b) => a + b, 0) / lastCycle.length;
  const cycles = Math.max(1, Math.floor(n / m));
  let trend = cycles > 1 ? (lastMean - level) / ((cycles - 1) * m) : 0;
  const seasonals = seed.map((v) => v - level);

  for (let i = 0; i < n; i++) {
    const s = seasonals[i % m];
    const prevLevel = level;
    level = alpha * (history[i] - s) + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
    seasonals[i % m] = gamma * (history[i] - level) + (1 - gamma) * s;
  }

  // Anchor the forecast level to the recent-year average.
  const seasonalMean = seasonals.reduce((a, b) => a + b, 0) / seasonals.length;
  const anchor = lastMean - seasonalMean;
  level = 0.5 * level + 0.5 * anchor;

  // Clip each forecast to the historical envelope so the projection never
  // swings above the highest or below the lowest weekly value we've seen.
  const { lo, hi } = envelope(history);
  const forecast: number[] = [];
  let dampedTrendSum = 0;
  for (let h = 1; h <= horizon; h++) {
    dampedTrendSum += Math.pow(phi, h);
    const s = seasonals[(n + h - 1) % m];
    const raw = level + trend * dampedTrendSum + s;
    forecast.push(Math.min(hi, Math.max(lo, raw)));
  }
  return { name: "Exponential Smoothing", forecast, applicable: true };
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
