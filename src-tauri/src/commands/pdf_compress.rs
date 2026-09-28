//! PDF compression for the compressor tool. Most of a typical PDF's weight
//! is embedded photos/scans, so the real savings come from re-encoding
//! those as smaller JPEGs (optionally downscaled); everything else is
//! rewritten losslessly (unused objects dropped, streams deflated, object
//! and xref streams). Text, vectors and fonts are untouched — the result
//! stays a normal, selectable PDF.

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage, ImageFormat, RgbImage};
use lopdf::{Document, LoadOptions, Object, Stream};
use serde::Serialize;
use tauri::ipc::{Request, Response};

use crate::commands::raw_upload::{header, raw_body};
use crate::plans::{self, Feature};

/// Refuses to decode any single image stream bigger than this — guards
/// against decompression bombs in untrusted PDFs.
const MAX_DECODED_IMAGE_BYTES: usize = 256 * 1024 * 1024;

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct PdfStats {
    pub images_total: usize,
    pub images_recompressed: usize,
}

fn name_of<'a>(stream: &'a Stream, key: &[u8]) -> Option<&'a [u8]> {
    stream.dict.get(key).ok().and_then(|o| o.as_name().ok())
}

fn int_of(stream: &Stream, key: &[u8]) -> Option<i64> {
    stream.dict.get(key).ok().and_then(|o| o.as_i64().ok())
}

/// Decodes an image XObject we know how to handle safely: 8-bit DeviceRGB
/// or DeviceGray, either JPEG (DCTDecode) or raw deflated pixels
/// (FlateDecode without predictors). Anything else (CMYK, indexed palettes,
/// masks, 1-bit scans, JBIG2, custom Decode arrays...) is left as is,
/// since re-encoding it could change how it looks.
fn decode_image(stream: &Stream) -> Option<DynamicImage> {
    if name_of(stream, b"Subtype") != Some(b"Image") {
        return None;
    }
    if stream.dict.has(b"Decode") || stream.dict.has(b"ImageMask") || stream.dict.has(b"Mask") {
        return None;
    }
    if int_of(stream, b"BitsPerComponent") != Some(8) {
        return None;
    }
    let gray = match name_of(stream, b"ColorSpace")? {
        b"DeviceRGB" => false,
        b"DeviceGray" => true,
        _ => return None,
    };
    let width = u32::try_from(int_of(stream, b"Width")?).ok()?;
    let height = u32::try_from(int_of(stream, b"Height")?).ok()?;
    let channels = if gray { 1 } else { 3 };
    if (width as usize) * (height as usize) * channels > MAX_DECODED_IMAGE_BYTES {
        return None;
    }

    let filters = stream.filters().ok()?;
    match filters.as_slice() {
        [b"DCTDecode"] => {
            let img = image::load_from_memory_with_format(&stream.content, ImageFormat::Jpeg).ok()?;
            // A JPEG whose own color model disagrees with the dictionary
            // (e.g. CMYK data) isn't safe to touch.
            let matches = if gray { img.color().channel_count() == 1 } else { img.color().channel_count() == 3 };
            matches.then_some(img)
        }
        [b"FlateDecode"] if !stream.dict.has(b"DecodeParms") => {
            let raw = stream.decompressed_content_with_limit(MAX_DECODED_IMAGE_BYTES).ok()?;
            if gray {
                GrayImage::from_raw(width, height, raw).map(DynamicImage::ImageLuma8)
            } else {
                RgbImage::from_raw(width, height, raw).map(DynamicImage::ImageRgb8)
            }
        }
        _ => None,
    }
}

fn encode_jpeg(img: &DynamicImage, quality: u8) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, quality);
    match img {
        DynamicImage::ImageLuma8(g) => encoder.encode_image(g).ok()?,
        other => encoder.encode_image(&other.to_rgb8()).ok()?,
    }
    Some(out)
}

/// `quality`: 1–100 JPEG quality for embedded images. `max_dimension`:
/// longest side for embedded images in pixels, 0 = keep size.
pub fn compress_pdf_bytes(input: &[u8], quality: u8, max_dimension: u32) -> Result<(Vec<u8>, PdfStats), String> {
    let options = LoadOptions {
        max_decompressed_size: Some(MAX_DECODED_IMAGE_BYTES),
        ..Default::default()
    };
    let mut doc =
        Document::load_mem_with_options(input, options).map_err(|e| format!("PDF inválido ou corrompido: {e}"))?;
    if doc.is_encrypted() || doc.trailer.has(b"Encrypt") {
        return Err("PDF protegido por senha — não é possível comprimir.".into());
    }

    let mut stats = PdfStats::default();
    for object in doc.objects.values_mut() {
        let Object::Stream(stream) = object else { continue };
        if name_of(stream, b"Subtype") != Some(b"Image") {
            continue;
        }
        stats.images_total += 1;
        let Some(mut img) = decode_image(stream) else { continue };

        if max_dimension > 0 && img.width().max(img.height()) > max_dimension {
            img = img.resize(max_dimension, max_dimension, FilterType::Triangle);
        }
        let Some(jpeg) = encode_jpeg(&img, quality) else { continue };
        // Only keep the new version when it actually saves space.
        if jpeg.len() >= stream.content.len() {
            continue;
        }
        stream.dict.set("Filter", "DCTDecode");
        stream.dict.remove(b"DecodeParms");
        stream.dict.set("Width", img.width() as i64);
        stream.dict.set("Height", img.height() as i64);
        stream.set_content(jpeg);
        stream.allows_compression = false; // already JPEG — deflating it again gains nothing
        stats.images_recompressed += 1;
    }

    doc.prune_objects();
    doc.compress();
    let mut out = Vec::new();
    doc.save_modern(&mut out).map_err(|e| format!("Falha ao gravar o PDF: {e}"))?;

    // Lossless rewriting can occasionally come out bigger (an already
    // optimized PDF); never hand back something worse than the input.
    if out.len() >= input.len() {
        return Ok((input.to_vec(), stats));
    }
    Ok((out, stats))
}

/// Raw PDF bytes in the request body (not a JSON number array — see
/// OCR's command for why), options in headers. Returns the compressed PDF
/// as raw bytes. Consumes one of the compressor's daily uses first, same
/// as an image going through the frontend's Canvas path.
#[tauri::command]
pub async fn compress_pdf(app: tauri::AppHandle, request: Request<'_>) -> Result<Response, String> {
    let bytes = raw_body(&request)?;
    let quality = header(&request, "x-quality").and_then(|v| v.parse::<u8>().ok()).unwrap_or(75).clamp(1, 100);
    let max_dimension = header(&request, "x-max-dimension").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);

    plans::consume_daily(&app, Feature::CompressorDaily)?;
    let (out, _stats) = tauri::async_runtime::spawn_blocking(move || compress_pdf_bytes(&bytes, quality, max_dimension))
        .await
        .map_err(|e| format!("Falha ao comprimir: {e}"))??;
    Ok(Response::new(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Object as O};

    /// A one-page PDF with a big, noisy, losslessly-stored RGB image —
    /// the worst case the compressor is meant for.
    fn sample_pdf() -> Vec<u8> {
        let (w, h) = (400u32, 300u32);
        let mut pixels = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h {
            for x in 0..w {
                pixels.extend_from_slice(&[(x % 256) as u8, (y % 256) as u8, ((x * y) % 256) as u8]);
            }
        }
        let mut doc = Document::with_version("1.5");
        let mut image = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => w as i64,
                "Height" => h as i64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            },
            pixels,
        );
        image.compress().unwrap();
        let image_id = doc.add_object(image);
        let content = doc.add_object(Stream::new(dictionary! {}, b"q 400 0 0 300 0 0 cm /Im1 Do Q".to_vec()));
        let pages_id = doc.new_object_id();
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 400.into(), 300.into()],
            "Contents" => content,
            "Resources" => dictionary! { "XObject" => dictionary! { "Im1" => image_id } },
        });
        doc.objects.insert(
            pages_id,
            O::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[test]
    fn shrinks_embedded_images_and_stays_a_valid_pdf() {
        let input = sample_pdf();
        let (out, stats) = compress_pdf_bytes(&input, 60, 200).unwrap();
        assert_eq!(stats, PdfStats { images_total: 1, images_recompressed: 1 });
        assert!(out.len() < input.len() / 2, "{} → {}", input.len(), out.len());

        let reloaded = Document::load_mem(&out).expect("output must load");
        assert_eq!(reloaded.get_pages().len(), 1);
        let image = reloaded
            .objects
            .values()
            .find_map(|o| match o {
                O::Stream(s) if name_of(s, b"Subtype") == Some(b"Image") => Some(s),
                _ => None,
            })
            .unwrap();
        assert_eq!(image.filters().unwrap(), vec![b"DCTDecode".as_slice()]);
        assert_eq!(int_of(image, b"Width"), Some(200));
        assert_eq!(int_of(image, b"Height"), Some(150));
    }

    #[test]
    fn never_returns_something_bigger() {
        let input = sample_pdf();
        let (once, _) = compress_pdf_bytes(&input, 60, 0).unwrap();
        let (twice, _) = compress_pdf_bytes(&once, 95, 0).unwrap();
        assert!(twice.len() <= once.len());
    }

    #[test]
    fn rejects_garbage() {
        assert!(compress_pdf_bytes(b"not a pdf", 70, 0).is_err());
    }
}
