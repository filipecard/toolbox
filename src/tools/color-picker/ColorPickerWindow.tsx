import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { collapseTool, consumeFeatureUse } from "../../shared/tauri";
import { formatQuota, isQuotaExceeded, useQuota } from "../../shared/plans";
import {
  buildHarmonies,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  isValidHex,
  normalizeHex,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  type Hsl,
  type Rgb,
} from "./colorMath";

/* The eyedropper itself, manual hex/rgb/hsl entry and the recent-colors
 * strip are all free. The generated harmony palettes (complementary,
 * analogous, triadic...) are the paid feature: each "Gerar paletas" click
 * consumes one of the plan's daily uses (see plans.rs). The palettes stay
 * pinned to the color they were generated from (so clicking one of their
 * swatches doesn't make them vanish); generating for another color is a
 * new use. */

/** Minimal ambient type for the EyeDropper Web API (Chromium/WebView2),
 * which isn't part of lib.dom.d.ts yet. */
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperLike {
  open(): Promise<EyeDropperResult>;
}
declare global {
  interface Window {
    EyeDropper?: new () => EyeDropperLike;
  }
}

const MAX_RECENT = 8;
// Fixed backing resolution for the SV canvas — CSS stretches it to the
// panel's width, so this only needs to be fine enough that the gradient
// doesn't look banded, not match the on-screen pixel size.
const SV_CANVAS_W = 240;
const SV_CANVAS_H = 140;

const clamp01to100 = (n: number) => Math.min(100, Math.max(0, n));

export function ColorPickerWindow({ toolId }: { toolId: string }) {
  const [hex, setHex] = useState("#3399ff");
  const [hexInput, setHexInput] = useState("#3399ff");
  const [recent, setRecent] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const eyeDropperSupported = typeof window !== "undefined" && !!window.EyeDropper;

  const rgb: Rgb = hexToRgb(hex);
  const hsl: Hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);

  useEffect(() => {
    setHexInput(hex);
  }, [hex]);

  // Redraws the saturation/value gradient whenever the hue changes (via the
  // hue slider, the hex/rgb/hsl fields, the eyedropper, or a recent/harmony
  // swatch) — the square's own drag doesn't change hue, so it doesn't need
  // to repaint the gradient itself, just move the marker (done via inline
  // style below, off `hsv.s`/`hsv.v` directly).
  useEffect(() => {
    const canvas = svCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const hueRgb = hsvToRgb({ h: hsv.h, s: 100, v: 100 });
    ctx.fillStyle = rgbToHex(hueRgb);
    ctx.fillRect(0, 0, SV_CANVAS_W, SV_CANVAS_H);

    const whiteGrad = ctx.createLinearGradient(0, 0, SV_CANVAS_W, 0);
    whiteGrad.addColorStop(0, "rgba(255,255,255,1)");
    whiteGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, SV_CANVAS_W, SV_CANVAS_H);

    const blackGrad = ctx.createLinearGradient(0, 0, 0, SV_CANVAS_H);
    blackGrad.addColorStop(0, "rgba(0,0,0,0)");
    blackGrad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, SV_CANVAS_W, SV_CANVAS_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsv.h]);

  const applyHex = (value: string) => {
    const normalized = normalizeHex(value);
    setHex(normalized);
    setRecent((prev) => [normalized, ...prev.filter((c) => c !== normalized)].slice(0, MAX_RECENT));
  };

  const handleHexInputChange = (value: string) => {
    setHexInput(value);
    if (isValidHex(value)) applyHex(value);
  };

  const handleRgbChange = (channel: keyof Rgb, value: number) => {
    applyHex(rgbToHex({ ...rgb, [channel]: value }));
  };

  const handleHslChange = (channel: keyof Hsl, value: number) => {
    applyHex(rgbToHex(hslToRgb({ ...hsl, [channel]: value })));
  };

  const handleHueChange = (h: number) => {
    applyHex(rgbToHex(hsvToRgb({ h, s: hsv.s, v: hsv.v })));
  };

  const applyFromSvPointer = (clientX: number, clientY: number) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = clamp01to100(((clientX - rect.left) / rect.width) * 100);
    const v = clamp01to100((1 - (clientY - rect.top) / rect.height) * 100);
    applyHex(rgbToHex(hsvToRgb({ h: hsv.h, s, v })));
  };

  const handleSvPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    applyFromSvPointer(e.clientX, e.clientY);
  };

  const handleSvPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons !== 1) return;
    applyFromSvPointer(e.clientX, e.clientY);
  };

  const handlePickFromScreen = async () => {
    if (!window.EyeDropper) return;
    try {
      const result = await new window.EyeDropper().open();
      applyHex(result.sRGBHex);
    } catch {
      // User pressed Esc / cancelled the pick — nothing to do.
    }
  };

  const copy = (label: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(label);
    if (copyTimeout.current) clearTimeout(copyTimeout.current);
    copyTimeout.current = setTimeout(() => setCopied(null), 1200);
  };

  const rgbText = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  const hslText = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  const [harmonyQuota, setHarmonyQuota] = useQuota("harmoniesDaily");
  const [harmonyBase, setHarmonyBase] = useState<{ hex: string; hsl: Hsl } | null>(null);
  const [harmonyError, setHarmonyError] = useState<string | null>(null);
  const harmonies = harmonyBase ? buildHarmonies(harmonyBase.hsl) : null;

  const generateHarmonies = async () => {
    setHarmonyError(null);
    try {
      setHarmonyQuota(await consumeFeatureUse("harmoniesDaily"));
      setHarmonyBase({ hex, hsl });
    } catch (e) {
      setHarmonyError(String(e));
    }
  };

  return (
    <div className="panel color-picker">
      <TitleBar
        title="Seletor de cor"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body color-picker-body">
        <div className="cp-preview" style={{ background: hex }} />

        <div className="cp-gradient-wrap">
          <canvas
            ref={svCanvasRef}
            className="cp-sv-canvas"
            width={SV_CANVAS_W}
            height={SV_CANVAS_H}
            onPointerDown={handleSvPointerDown}
            onPointerMove={handleSvPointerMove}
          />
          <div
            className="cp-sv-marker"
            style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: hex }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={360}
          value={hsv.h}
          className="cp-hue-slider"
          onChange={(e) => handleHueChange(Number(e.target.value))}
        />
        <p className="settings-hint cp-gradient-hint">
          Arraste no quadrado para ajustar a cor a partir do tom escolhido no controle deslizante.
        </p>

        <button
          className="var-add-btn cp-pick-btn"
          disabled={!eyeDropperSupported}
          onClick={() => void handlePickFromScreen()}
        >
          🎯 Capturar cor da tela
        </button>
        {!eyeDropperSupported && (
          <p className="settings-hint">
            Captura de tela indisponível neste WebView2. Use os campos abaixo.
          </p>
        )}

        <div className="cp-field-row">
          <span className="cp-field-label">HEX</span>
          <input
            className="cp-field-input"
            value={hexInput}
            onChange={(e) => handleHexInputChange(e.target.value)}
            spellCheck={false}
          />
          <button className="cp-copy-btn" onClick={() => copy("hex", hex)}>
            {copied === "hex" ? "✓" : "Copiar"}
          </button>
        </div>

        <div className="cp-field-row">
          <span className="cp-field-label">RGB</span>
          <div className="cp-triplet">
            {(["r", "g", "b"] as const).map((c) => (
              <input
                key={c}
                type="number"
                min={0}
                max={255}
                className="cp-num-input"
                value={rgb[c]}
                onChange={(e) => handleRgbChange(c, Number(e.target.value))}
              />
            ))}
          </div>
          <button className="cp-copy-btn" onClick={() => copy("rgb", rgbText)}>
            {copied === "rgb" ? "✓" : "Copiar"}
          </button>
        </div>

        <div className="cp-field-row">
          <span className="cp-field-label">HSL</span>
          <div className="cp-triplet">
            <input
              type="number"
              min={0}
              max={360}
              className="cp-num-input"
              value={hsl.h}
              onChange={(e) => handleHslChange("h", Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={100}
              className="cp-num-input"
              value={hsl.s}
              onChange={(e) => handleHslChange("s", Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={100}
              className="cp-num-input"
              value={hsl.l}
              onChange={(e) => handleHslChange("l", Number(e.target.value))}
            />
          </div>
          <button className="cp-copy-btn" onClick={() => copy("hsl", hslText)}>
            {copied === "hsl" ? "✓" : "Copiar"}
          </button>
        </div>

        {recent.length > 0 && (
          <div className="cp-recent">
            <span className="cp-section-label">Recentes</span>
            <div className="cp-swatch-row">
              {recent.map((c) => (
                <button
                  key={c}
                  className="cp-swatch"
                  style={{ background: c }}
                  title={c}
                  onClick={() => applyHex(c)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="cp-harmonies">
          <span className="cp-section-label">Paletas harmônicas</span>
          {harmonyBase && harmonyBase.hex !== hex && (
            <div className="cp-harmony-row">
              <span className="settings-hint">Paletas da cor {harmonyBase.hex}</span>
              <button
                className="var-add-btn"
                onClick={() => void generateHarmonies()}
                disabled={isQuotaExceeded(harmonyQuota)}
              >
                Gerar para a cor atual
              </button>
            </div>
          )}
          {harmonies ? (
            harmonies.map((harmony) => (
              <div key={harmony.label} className="cp-harmony-row">
                <span className="cp-harmony-label">{harmony.label}</span>
                <div className="cp-swatch-row">
                  {harmony.hexes.map((c, i) => (
                    <button
                      key={i}
                      className="cp-swatch"
                      style={{ background: c }}
                      title={c}
                      onClick={() => applyHex(c)}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="cp-locked">
              <p className="settings-hint cp-locked-text">
                Combinações de cores prontas (complementar, análoga, triádica, split-complementar,
                tetrádica) a partir da cor atual.
              </p>
              <button
                className="var-add-btn"
                onClick={() => void generateHarmonies()}
                disabled={isQuotaExceeded(harmonyQuota)}
              >
                Gerar paletas
              </button>
            </div>
          )}
          {harmonyError && <p className="ocr-error">{harmonyError}</p>}
          {harmonyQuota && <span className="ocr-quota">{formatQuota(harmonyQuota)}</span>}
        </div>
      </div>
    </div>
  );
}
