export interface UnitDef {
  id: string;
  label: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

export interface UnitCategory {
  id: string;
  label: string;
  units: UnitDef[];
}

function unit(id: string, label: string, factor: number): UnitDef {
  return { id, label, toBase: (v) => v * factor, fromBase: (v) => v / factor };
}

export const UNIT_CATEGORIES: UnitCategory[] = [
  {
    id: "length",
    label: "Comprimento",
    units: [
      unit("m", "Metro (m)", 1),
      unit("km", "Quilômetro (km)", 1000),
      unit("cm", "Centímetro (cm)", 0.01),
      unit("mm", "Milímetro (mm)", 0.001),
      unit("mi", "Milha (mi)", 1609.344),
      unit("yd", "Jarda (yd)", 0.9144),
      unit("ft", "Pé (ft)", 0.3048),
      unit("in", "Polegada (in)", 0.0254),
    ],
  },
  {
    id: "mass",
    label: "Peso",
    units: [
      unit("kg", "Quilograma (kg)", 1),
      unit("g", "Grama (g)", 0.001),
      unit("mg", "Miligrama (mg)", 0.000001),
      unit("ton", "Tonelada (t)", 1000),
      unit("lb", "Libra (lb)", 0.45359237),
      unit("oz", "Onça (oz)", 0.028349523125),
    ],
  },
  {
    id: "temperature",
    label: "Temperatura",
    units: [
      { id: "c", label: "Celsius (°C)", toBase: (v) => v, fromBase: (v) => v },
      {
        id: "f",
        label: "Fahrenheit (°F)",
        toBase: (v) => ((v - 32) * 5) / 9,
        fromBase: (v) => (v * 9) / 5 + 32,
      },
      { id: "k", label: "Kelvin (K)", toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
    ],
  },
  {
    id: "volume",
    label: "Volume",
    units: [
      unit("l", "Litro (L)", 1),
      unit("ml", "Mililitro (mL)", 0.001),
      unit("m3", "Metro cúbico (m³)", 1000),
      unit("galUS", "Galão US (gal)", 3.785411784),
      unit("qt", "Quarto (qt)", 0.946352946),
      unit("pt", "Pinta (pt)", 0.473176473),
      unit("cup", "Xícara (cup)", 0.2365882365),
      unit("flOz", "Onça fluida (fl oz)", 0.0295735295625),
    ],
  },
  {
    id: "area",
    label: "Área",
    units: [
      unit("m2", "Metro² (m²)", 1),
      unit("km2", "Quilômetro² (km²)", 1_000_000),
      unit("ha", "Hectare (ha)", 10000),
      unit("ft2", "Pé² (ft²)", 0.09290304),
      unit("acre", "Acre", 4046.8564224),
    ],
  },
  {
    id: "speed",
    label: "Velocidade",
    units: [
      unit("ms", "Metro/segundo (m/s)", 1),
      unit("kmh", "Quilômetro/hora (km/h)", 1 / 3.6),
      unit("mph", "Milha/hora (mph)", 0.44704),
      unit("knot", "Nó (kn)", 0.514444444),
    ],
  },
  {
    id: "time",
    label: "Tempo",
    units: [
      unit("s", "Segundo (s)", 1),
      unit("min", "Minuto (min)", 60),
      unit("h", "Hora (h)", 3600),
      unit("day", "Dia", 86400),
      unit("week", "Semana", 604800),
    ],
  },
  {
    id: "data",
    label: "Dados",
    units: [
      unit("bit", "Bit", 0.125),
      unit("byte", "Byte", 1),
      unit("kb", "Kilobyte (KB)", 1024),
      unit("mb", "Megabyte (MB)", 1024 ** 2),
      unit("gb", "Gigabyte (GB)", 1024 ** 3),
      unit("tb", "Terabyte (TB)", 1024 ** 4),
    ],
  },
];

export function convert(category: UnitCategory, fromId: string, toId: string, value: number): number {
  const from = category.units.find((u) => u.id === fromId);
  const to = category.units.find((u) => u.id === toId);
  if (!from || !to || !Number.isFinite(value)) return NaN;
  return to.fromBase(from.toBase(value));
}
