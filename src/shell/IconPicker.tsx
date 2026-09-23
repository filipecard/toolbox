import { useRef, useState } from "react";

const PRESET_ICONS = [
  "🧮", "📝", "📅", "⏰", "📁", "🔍", "🎨", "🎵",
  "📷", "🗂️", "✅", "💡", "🔒", "🌐", "⭐", "🛠️",
  "📌", "🔔", "📊", "💬",
];

const ICON_EXPORT_SIZE = 128;
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;

function renderCroppedIcon(img: HTMLImageElement, zoom: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_EXPORT_SIZE;
  canvas.height = ICON_EXPORT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return img.src;

  ctx.save();
  ctx.beginPath();
  ctx.arc(ICON_EXPORT_SIZE / 2, ICON_EXPORT_SIZE / 2, ICON_EXPORT_SIZE / 2, 0, Math.PI * 2);
  ctx.clip();

  const coverScale = Math.max(ICON_EXPORT_SIZE / img.width, ICON_EXPORT_SIZE / img.height) * zoom;
  const drawW = img.width * coverScale;
  const drawH = img.height * coverScale;
  ctx.drawImage(img, (ICON_EXPORT_SIZE - drawW) / 2, (ICON_EXPORT_SIZE - drawH) / 2, drawW, drawH);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

export function IconPicker({
  onClose,
  onSelectEmoji,
  onSelectImage,
  onReset,
}: {
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  onSelectImage: (dataUrl: string) => void;
  /** Clears the user's custom icon, going back to the tool's default. */
  onReset: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImg, setPendingImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setZoom(MIN_ZOOM);
        setPendingImg(img);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const confirmImage = () => {
    if (!pendingImg) return;
    onSelectImage(renderCroppedIcon(pendingImg, zoom));
  };

  return (
    <div className="icon-picker-backdrop" onClick={onClose}>
      <div className="icon-picker-card" onClick={(e) => e.stopPropagation()}>
        {pendingImg ? (
          <>
            <div className="icon-picker-preview">
              <img src={pendingImg.src} alt="" style={{ transform: `scale(${zoom})` }} />
            </div>
            <input
              className="icon-picker-zoom"
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <div className="icon-picker-actions">
              <button className="icon-picker-btn" onClick={() => setPendingImg(null)}>
                Cancelar
              </button>
              <button className="icon-picker-btn icon-picker-btn-primary" onClick={confirmImage}>
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="icon-picker-heading">Escolher ícone</div>
            <div className="icon-picker-grid">
              {PRESET_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  className="icon-picker-emoji"
                  onClick={() => onSelectEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button className="icon-picker-btn" onClick={() => fileInputRef.current?.click()}>
              Enviar imagem...
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
            <button className="icon-picker-btn" onClick={onReset}>
              Restaurar ícone padrão
            </button>
            <button className="icon-picker-btn" onClick={onClose}>
              Fechar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
