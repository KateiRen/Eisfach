// WebP is already compressed. Eisfach archives use the ZIP STORE method, without ZIP64.
export const MAX_ZIP_SIZE = 100 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function check(condition, message) {
  if (!condition) throw new Error(`ZIP: ${message}`);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function validName(name) {
  check(name === 'inventory.json' || /^images\/[0-9a-f-]{36}\.webp$/.test(name),
    'Unerwarteter Dateiname.');
}

export function createZip(files) {
  check(files instanceof Map && files.size > 0 && files.size <= MAX_ENTRIES,
    'Maximal 2000 Dateien pro Sicherung.');
  const parts = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;
  for (const [name, bytes] of files) {
    validName(name);
    check(bytes instanceof Uint8Array, 'Dateiinhalt fehlt.');
    const filename = encoder.encode(name);
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + filename.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true);
    header.setUint16(12, 33, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, filename.length, true);
    local.set(filename, 30);
    const central = new Uint8Array(46 + filename.length);
    const entry = new DataView(central.buffer);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 33, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, bytes.length, true);
    entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, filename.length, true);
    entry.setUint32(42, offset, true);
    central.set(filename, 46);
    parts.push(local, bytes);
    directory.push(central);
    offset += local.length + bytes.length;
    directorySize += central.length;
    check(offset + directorySize + 22 <= MAX_ZIP_SIZE, 'Sicherung ist größer als 100 MB.');
  }
  const footer = new Uint8Array(22);
  const end = new DataView(footer.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.size, true);
  end.setUint16(10, files.size, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, footer], { type: 'application/zip' });
}

export function readZip(bytes) {
  check(bytes instanceof Uint8Array && bytes.length >= 22 && bytes.length <= MAX_ZIP_SIZE,
    'Ungültige Größe (maximal 100 MB).');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  check(view.getUint32(end, true) === 0x06054b50 && view.getUint16(end + 20, true) === 0,
    'Nur unveränderte Eisfach-ZIP-Sicherungen werden unterstützt.');
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  check(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0 &&
    view.getUint16(end + 8, true) === count && count > 0 && count <= MAX_ENTRIES &&
    start + directorySize === end, 'Verzeichnis ist ungültig.');
  const files = new Map();
  let cursor = start;
  let localOffset = 0;
  for (let index = 0; index < count; index++) {
    check(cursor + 46 <= end && view.getUint32(cursor, true) === 0x02014b50, 'Verzeichnis beschädigt.');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    check(method === 0 && flags === 0x0800, 'Nur unverschlüsselte Eisfach-ZIP-Dateien ohne Neukomprimierung werden unterstützt.');
    check(view.getUint32(cursor + 20, true) === size && view.getUint16(cursor + 34, true) === 0 &&
      extraLength === 0 && commentLength === 0 && cursor + 46 + nameLength <= end &&
      local === localOffset && local + 30 <= start, 'Dateieintrag beschädigt.');
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    validName(name);
    check(!files.has(name), 'Doppelter Dateiname.');
    const dataStart = local + 30 + nameLength;
    check(dataStart + size <= start && view.getUint32(local, true) === 0x04034b50 &&
      view.getUint16(local + 6, true) === flags && view.getUint16(local + 8, true) === method &&
      view.getUint32(local + 14, true) === crc && view.getUint32(local + 18, true) === size &&
      view.getUint32(local + 22, true) === size && view.getUint16(local + 26, true) === nameLength &&
      view.getUint16(local + 28, true) === 0 &&
      decoder.decode(bytes.subarray(local + 30, dataStart)) === name, 'Dateikopf beschädigt.');
    const content = bytes.subarray(dataStart, dataStart + size);
    check(crc32(content) === crc, `${name}: Prüfsumme stimmt nicht.`);
    files.set(name, content);
    localOffset = dataStart + size;
    cursor += 46 + nameLength;
  }
  check(cursor === end && localOffset === start && files.has('inventory.json'), 'Sicherungsdatei fehlt oder Archiv ist beschädigt.');
  return files;
}
