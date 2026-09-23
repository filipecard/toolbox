import type { QuickMenuItemSetting } from "../shared/settingsStore";
import type { ToolCatalogEntry } from "./toolCatalog";

/**
 * A quick-menu item's icon, in priority order: the user's uploaded image,
 * then the user's chosen emoji, then the catalog's default SVG, then the
 * catalog's emoji. User customizations always win over the defaults.
 */
export function ToolIcon({
  item,
  catalog,
  imgClassName,
}: {
  item: QuickMenuItemSetting;
  catalog: ToolCatalogEntry;
  imgClassName: string;
}) {
  if (item.iconImage) return <img className={imgClassName} src={item.iconImage} alt="" />;
  // An override equal to the catalog's own emoji isn't really a
  // customization (e.g. re-picked from the preset grid before SVG defaults
  // existed) — let the SVG default show instead.
  if (item.icon && item.icon !== catalog.icon) return <>{item.icon}</>;
  if (catalog.iconSrc) return <SvgIcon src={catalog.iconSrc} mono={catalog.iconMono} />;
  return <>{catalog.icon}</>;
}

/** A default SVG glyph, sized relative to its circle (see `.svg-icon`). */
export function SvgIcon({ src, mono }: { src: string; mono?: boolean }) {
  return <img className={`svg-icon${mono ? " svg-icon-mono" : ""}`} src={src} alt="" draggable={false} />;
}
