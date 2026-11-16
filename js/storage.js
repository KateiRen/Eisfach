import { request, rest, edge } from './supabase.js';

export async function loadImageURL(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Bitte eine gültige HTTP- oder HTTPS-Bild-URL eingeben.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Bitte eine HTTP- oder HTTPS-Bild-URL ohne Zugangsdaten eingeben.');
  }
  const signal = AbortSignal.timeout(15_000);
  let response;
  try {
    response = await fetch(url.href, {
      mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal,
    });
  } catch (error) {
    throw new Error('Bild-URL konnte nicht geladen werden. Bitte die URL, Internetverbindung und CORS-Freigabe der Bildquelle prüfen.', { cause: error });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Bild-URL konnte nicht geladen werden (HTTP ${response.status}).`);
  }
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const maxBytes = 25 * 1024 * 1024;
  if (!type.startsWith('image/')) {
    await response.body?.cancel();
    throw new Error('Die Bild-URL muss direkt auf eine Bilddatei verweisen, nicht auf eine Webseite.');
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Das Bild aus der URL darf maximal 25 MB groß sein.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Die Bild-URL hat kein Bild geliefert.');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw new Error('Das Bild aus der URL konnte nicht vollständig geladen werden. Bitte erneut versuchen.', { cause: error });
      }
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('Das Bild aus der URL darf maximal 25 MB groß sein.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error('Die Bild-URL hat eine leere Bilddatei geliefert.');
  return new File(chunks, 'Bild aus URL', { type });
}

export async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) {
    throw new Error('Bitte ein Bild mit maximal 25 MB wählen.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', .82));
    if (!blob || blob.type !== 'image/webp') throw new Error('Dieser Browser unterstützt keine WebP-Komprimierung.');
    return blob;
  } finally {
    bitmap.close();
  }
}

export async function uploadImage(itemId, file, sortOrder = 0) {
  const blob = await compressImage(file);
  const { path } = await request('/functions/v1/imageStorage', {
    method: 'POST', body: blob,
    headers: { 'Content-Type': 'image/webp', 'x-item-id': itemId, 'x-file-id': crypto.randomUUID() },
  });
  try {
    await rest('item_images', '', {
      method: 'POST', body: { item_id: itemId, path, caption: file.name.slice(0, 200), sort_order: sortOrder },
    });
  } catch (error) {
    await removeObject(path).catch(() => {});
    throw error;
  }
}

const removeObject = (path) => edge('imageStorage', { action: 'delete', path });

export async function removeImage(image) {
  await removeObject(image.path);
  await rest('item_images', `?id=eq.${encodeURIComponent(image.id)}`, { method: 'DELETE' });
}

export async function imageURL(path) {
  const result = await edge('imageStorage', { action: 'sign', path });
  return result.signedURL;
}

export function validateWebP(bytes) {
  const text = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
  if (!(bytes instanceof Uint8Array) || bytes.length < 20 || bytes.length > 5 * 1024 * 1024 ||
      text(0, 4) !== 'RIFF' || text(8, 12) !== 'WEBP' ||
      !['VP8 ', 'VP8L', 'VP8X'].includes(text(12, 16)) ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) !== bytes.length - 8) {
    throw new Error('Ungültiges WebP-Bild (maximal 5 MB).');
  }
}

export async function downloadImage(path) {
  const url = await imageURL(path);
  const response = await fetch(url, {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Bild konnte nicht geladen werden (${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Bildinhalt fehlt.');
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 5 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Bild ist größer als 5 MB.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  validateWebP(bytes);
  return bytes;
}

export async function restoreImage(image, bytes, fileId) {
  validateWebP(bytes);
  const path = `${image.inventory_id}/${image.item_id}/${fileId}.webp`;
  try {
    const saved = await request('/functions/v1/imageStorage', {
      method: 'POST', body: new Blob([bytes], { type: 'image/webp' }),
      headers: { 'Content-Type': 'image/webp', 'x-item-id': image.item_id, 'x-file-id': fileId },
    });
    if (saved.path !== path) throw new Error('Unerwarteter Bilderpfad beim Import.');
  } catch (error) {
    if (error.status !== 409) throw error;
    const existing = await downloadImage(path);
    if (existing.length !== bytes.length || existing.some((byte, index) => byte !== bytes[index])) {
      throw new Error('Ein vorhandenes Bild hat abweichenden Inhalt. Es wurde nicht überschrieben.');
    }
  }
  // Keep a completed upload on metadata failure so the same archive can resume safely.
  await rest('item_images', '', {
    method: 'POST', body: {
      id: image.id, item_id: image.item_id, path, caption: image.caption, sort_order: image.sort_order,
    },
  });
  return path;
}
