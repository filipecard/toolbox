import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { collapseTool } from "../../shared/tauri";
import { SearchableSelect } from "../../shell/SearchableSelect";
import { UNIT_CATEGORIES, convert } from "./units";
import { CURRENCY_NAMES, getRates, type CurrencyRates } from "./currencyRates";

const CURRENCY_TAB_ID = "currency";
const FALLBACK_CURRENCIES = ["USD", "EUR", "BRL", "GBP", "JPY", "ARS", "CAD", "AUD", "CHF", "CNY"];

export function ConverterWindow({ toolId }: { toolId: string }) {
  const [categoryId, setCategoryId] = useState<string>(UNIT_CATEGORIES[0].id);
  const isCurrency = categoryId === CURRENCY_TAB_ID;
  const category = UNIT_CATEGORIES.find((c) => c.id === categoryId);

  const [fromUnit, setFromUnit] = useState(UNIT_CATEGORIES[0].units[0].id);
  const [toUnit, setToUnit] = useState(UNIT_CATEGORIES[0].units[1].id);
  const [fromValue, setFromValue] = useState("1");

  const [fromCurrency, setFromCurrency] = useState("USD");
  const [toCurrency, setToCurrency] = useState("BRL");
  const [rates, setRates] = useState<CurrencyRates | null>(null);
  const [ratesStale, setRatesStale] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);

  const loadRates = async (forceRefresh: boolean) => {
    setRatesLoading(true);
    setRatesError(null);
    try {
      const result = await getRates(forceRefresh);
      setRates(result.rates);
      setRatesStale(result.stale);
    } catch (e) {
      setRatesError(String(e));
    } finally {
      setRatesLoading(false);
    }
  };

  // Only fetches once the currency tab is actually opened, and only once
  // per session (cache freshness is handled inside getRates itself).
  useEffect(() => {
    if (isCurrency && !rates && !ratesLoading) void loadRates(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrency]);

  const handleCategoryChange = (id: string) => {
    setCategoryId(id);
    if (id !== CURRENCY_TAB_ID) {
      const cat = UNIT_CATEGORIES.find((c) => c.id === id);
      if (cat) {
        setFromUnit(cat.units[0].id);
        setToUnit(cat.units[1].id);
      }
    }
  };

  const handleSwap = () => {
    if (isCurrency) {
      setFromCurrency(toCurrency);
      setToCurrency(fromCurrency);
    } else {
      setFromUnit(toUnit);
      setToUnit(fromUnit);
    }
  };

  const numericFrom = Number(fromValue.replace(",", "."));

  const result = useMemo(() => {
    if (!Number.isFinite(numericFrom)) return "";
    if (isCurrency) {
      const fromRate = rates?.rates[fromCurrency];
      const toRate = rates?.rates[toCurrency];
      if (!fromRate || !toRate) return "";
      const amountBase = numericFrom / fromRate;
      return (amountBase * toRate).toLocaleString("pt-BR", { maximumFractionDigits: 6 });
    }
    if (!category) return "";
    const value = convert(category, fromUnit, toUnit, numericFrom);
    return Number.isFinite(value) ? value.toLocaleString("pt-BR", { maximumFractionDigits: 8 }) : "";
  }, [isCurrency, rates, fromCurrency, toCurrency, category, fromUnit, toUnit, numericFrom]);

  const currencyOptions = useMemo(() => {
    const codes = rates ? Object.keys(rates.rates) : FALLBACK_CURRENCIES;
    return [...codes]
      .sort()
      .map((code) => ({ id: code, label: code, sublabel: CURRENCY_NAMES[code] }));
  }, [rates]);

  const unitOptions = useMemo(
    () => category?.units.map((u) => ({ id: u.id, label: u.label })) ?? [],
    [category],
  );

  return (
    <div className="panel converter">
      <TitleBar
        title="Conversor"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body conv-body">
        <div className="conv-tabs">
          {UNIT_CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`conv-tab${categoryId === c.id ? " conv-tab-active" : ""}`}
              onClick={() => handleCategoryChange(c.id)}
            >
              {c.label}
            </button>
          ))}
          <button
            className={`conv-tab${isCurrency ? " conv-tab-active" : ""}`}
            onClick={() => handleCategoryChange(CURRENCY_TAB_ID)}
          >
            Moeda
          </button>
        </div>

        <div className="conv-row">
          <input
            className="conv-value-input"
            value={fromValue}
            onChange={(e) => setFromValue(e.target.value)}
            inputMode="decimal"
            spellCheck={false}
          />
          <div className="conv-select-wrap">
            <SearchableSelect
              options={isCurrency ? currencyOptions : unitOptions}
              value={isCurrency ? fromCurrency : fromUnit}
              onChange={isCurrency ? setFromCurrency : setFromUnit}
            />
          </div>
        </div>

        <button className="conv-swap-btn" onClick={handleSwap} title="Inverter">
          ⇄
        </button>

        <div className="conv-row">
          <input className="conv-value-input" value={result} readOnly tabIndex={-1} />
          <div className="conv-select-wrap">
            <SearchableSelect
              options={isCurrency ? currencyOptions : unitOptions}
              value={isCurrency ? toCurrency : toUnit}
              onChange={isCurrency ? setToCurrency : setToUnit}
            />
          </div>
        </div>

        {isCurrency && (
          <div className="conv-currency-status">
            {ratesLoading && <p className="settings-hint">Buscando cotações...</p>}
            {ratesError && !rates && <p className="ocr-error">{ratesError}</p>}
            {rates && !ratesLoading && (
              <p className="settings-hint">
                Cotação {ratesStale ? "desatualizada (sem conexão)" : "atualizada"} em{" "}
                {new Date(rates.fetchedAt).toLocaleString("pt-BR")}
              </p>
            )}
            <button
              className="var-add-btn"
              disabled={ratesLoading}
              onClick={() => void loadRates(true)}
            >
              Atualizar cotações
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
