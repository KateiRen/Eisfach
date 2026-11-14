import { request, rest, edge } from './supabase.js';

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
