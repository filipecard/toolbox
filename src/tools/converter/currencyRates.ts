import { load, Store } from "@tauri-apps/plugin-store";

/** Portuguese display names for the most commonly used currencies, so the
 * searchable currency picker can be searched by name ("real", "dólar") and
 * not just by code. Codes missing here just show their raw code — the API
 * covers ~160 currencies and translating all of them isn't worth it. */
export const CURRENCY_NAMES: Record<string, string> = {
  USD: "Dólar americano",
  EUR: "Euro",
  BRL: "Real brasileiro",
  GBP: "Libra esterlina",
  JPY: "Iene japonês",
  ARS: "Peso argentino",
  CAD: "Dólar canadense",
  AUD: "Dólar australiano",
  CHF: "Franco suíço",
  CNY: "Yuan chinês",
  MXN: "Peso mexicano",
  INR: "Rupia indiana",
  KRW: "Won sul-coreano",
  RUB: "Rublo russo",
  ZAR: "Rand sul-africano",
  SEK: "Coroa sueca",
  NOK: "Coroa norueguesa",
  DKK: "Coroa dinamarquesa",
  PLN: "Zloty polonês",
  TRY: "Lira turca",
  ILS: "Novo shekel israelense",
  SGD: "Dólar de Singapura",
  HKD: "Dólar de Hong Kong",
  NZD: "Dólar neozelandês",
  THB: "Baht tailandês",
  IDR: "Rupia indonésia",
  MYR: "Ringgit malaio",
  PHP: "Peso filipino",
  VND: "Dong vietnamita",
  AED: "Dirham dos Emirados",
  SAR: "Riyal saudita",
  EGP: "Libra egípcia",
  CLP: "Peso chileno",
  COP: "Peso colombiano",
  PEN: "Sol peruano",
  UYU: "Peso uruguaio",
  PYG: "Guarani paraguaio",
  BOB: "Boliviano",
};

export interface CurrencyRates {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

const RATES_KEY = "currencyRates";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Free, no-signup exchange-rate API (CORS-enabled) — fine for a converter
// that only needs daily-fresh rates, not the ideal source if ToolBox ever
// needs sub-daily accuracy. Rates are relative to USD and cached in
// store.json so opening the tool doesn't refetch every time.
const API_URL = "https://open.er-api.com/v6/latest/USD";

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  if (!storePromise) storePromise = load("store.json", { autoSave: false });
  return storePromise;
}

async function getCachedRates(): Promise<CurrencyRates | null> {
  const store = await getStore();
  return (await store.get<CurrencyRates>(RATES_KEY)) ?? null;
}

async function fetchRates(): Promise<CurrencyRates> {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`Falha ao buscar cotações (HTTP ${res.status}).`);
  const data = await res.json();
  if (data.result !== "success" || !data.rates) {
    throw new Error("Resposta inválida da API de câmbio.");
  }
  const rates: CurrencyRates = { base: data.base_code, rates: data.rates, fetchedAt: Date.now() };
  const store = await getStore();
  await store.set(RATES_KEY, rates);
  await store.save();
  return rates;
}

/** Returns cached rates if they're fresh (< 24h) unless `forceRefresh` is
 * set, otherwise fetches fresh ones — falling back to a stale cache (marked
 * via `stale: true`) rather than failing outright if the network call
 * itself fails, so the tool still works offline once it has fetched once. */
export async function getRates(forceRefresh: boolean): Promise<{ rates: CurrencyRates; stale: boolean }> {
  const cached = await getCachedRates();
  const isFresh = !!cached && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS;
  if (cached && isFresh && !forceRefresh) return { rates: cached, stale: false };

  try {
    const fresh = await fetchRates();
    return { rates: fresh, stale: false };
  } catch (e) {
    if (cached) return { rates: cached, stale: true };
    throw e;
  }
}
