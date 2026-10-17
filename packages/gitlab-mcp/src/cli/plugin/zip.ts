/**
 * Deterministic ZIP writer for plugin packages.
 *
 * Entries are sorted and stamped with the DOS epoch, so identical inputs give a
 * byte-identical archive and a reproducible checksum. Packages are a few
 * hundred kilobytes, so ZIP64 is refused rather than implemented.
 */

import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Forward-slash path inside the archive. */
  path: string;
  data: Buffer;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const VERSION = 20;
// High byte 3 = UNIX, so readers apply the permission bits below (APPNOTE 4.4.2).
const MADE_BY_UNIX = (3 << 8) | VERSION;
// Bit 11: file names are UTF-8 (APPNOTE 4.4.4).
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;
// 1980-01-01 00:00:00, the earliest DOS timestamp.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
// Regular file, rw-r--r--, in the high word of the external attributes.
const UNIX_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

/**
 * Orders strings by UTF-16 code units. Unlike localeCompare, the order does
 * not depend on the machine's locale, which keeps the archive reproducible.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function createZip(entries: ZipEntry[]): Buffer {
  if (entries.length > MAX_UINT16) {
    throw new Error(`ZIP holds at most ${MAX_UINT16} entries without ZIP64`);
  }
  const sorted = [...entries].sort((a, b) => compareCodeUnits(a.path, b.path));
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of sorted) {
    if (!entry.path || entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
      throw new Error(`Unsafe ZIP entry path: ${entry.path}`);
    }
    const name = Buffer.from(entry.path, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);
    if (entry.data.length > MAX_UINT32 || offset > MAX_UINT32) {
      throw new Error('ZIP entry exceeds 4 GiB without ZIP64');
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_HEADER, 0);
    header.writeUInt16LE(MADE_BY_UNIX, 4);
    header.writeUInt16LE(VERSION, 6);
    header.writeUInt16LE(FLAG_UTF8, 8);
    header.writeUInt16LE(METHOD_DEFLATE, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    // Extra field, comment, disk number, internal attributes: all empty.
    header.writeUInt32LE(UNIX_FILE_ATTRIBUTES, 38);
    header.writeUInt32LE(offset, 42);

    parts.push(local, name, compressed);
    central.push(header, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  if (offset > MAX_UINT32 || centralSize > MAX_UINT32) {
    throw new Error('ZIP exceeds 4 GiB without ZIP64');
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, ...central, end]);
}
