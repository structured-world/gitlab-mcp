/**
 * Unit tests for the deterministic plugin ZIP writer.
 * The archive is parsed here independently of the writer, so a header the
 * writer gets wrong fails the test instead of round-tripping silently.
 */

import { crc32, inflateRawSync } from 'zlib';
import { compareCodeUnits, createZip } from '../../../../src/cli/plugin/zip';

interface ParsedEntry {
  path: string;
  data: Buffer;
  flags: number;
  madeBy: number;
  externalAttributes: number;
}

function parseZip(zip: Buffer): ParsedEntry[] {
  const endOffset = zip.length - 22;
  expect(zip.readUInt32LE(endOffset)).toBe(0x06054b50);
  const count = zip.readUInt16LE(endOffset + 10);
  let pointer = zip.readUInt32LE(endOffset + 16);
  const entries: ParsedEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(pointer)).toBe(0x02014b50);
    const madeBy = zip.readUInt16LE(pointer + 4);
    const flags = zip.readUInt16LE(pointer + 8);
    const checksum = zip.readUInt32LE(pointer + 16);
    const compressedSize = zip.readUInt32LE(pointer + 20);
    const size = zip.readUInt32LE(pointer + 24);
    const nameLength = zip.readUInt16LE(pointer + 28);
    const externalAttributes = zip.readUInt32LE(pointer + 38);
    const localOffset = zip.readUInt32LE(pointer + 42);
    const path = zip.toString('utf8', pointer + 46, pointer + 46 + nameLength);

    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localName = zip.readUInt16LE(localOffset + 26);
    const localExtra = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const data = inflateRawSync(zip.subarray(start, start + compressedSize));
    expect(data).toHaveLength(size);
    expect(crc32(data)).toBe(checksum);

    entries.push({ path, data, flags, madeBy, externalAttributes });
    pointer += 46 + nameLength;
  }
  return entries;
}

describe('createZip', () => {
  it('stores every entry so a standard reader recovers the exact bytes', () => {
    const binary = Buffer.from([0, 1, 2, 255, 254, 0x89, 0x50]);
    const zip = createZip([
      { path: 'plugin.json', data: Buffer.from('{"name":"x"}\n') },
      { path: 'assets/logo.png', data: binary },
    ]);
    const parsed = parseZip(zip);
    expect(parsed.map((e) => e.path)).toEqual(['assets/logo.png', 'plugin.json']);
    expect(parsed[0].data.equals(binary)).toBe(true);
    expect(parsed[1].data.toString()).toBe('{"name":"x"}\n');
  });

  it('marks names as UTF-8 and files as UNIX rw-r--r--', () => {
    const [entry] = parseZip(createZip([{ path: 'skills/ü/SKILL.md', data: Buffer.from('a') }]));
    expect(entry.path).toBe('skills/ü/SKILL.md');
    expect(entry.flags & 0x0800).toBe(0x0800);
    // High byte 3 means the external attributes carry UNIX permissions.
    expect(entry.madeBy >> 8).toBe(3);
    expect(entry.externalAttributes >>> 16).toBe(0o100644);
  });

  it('produces identical bytes for the same files in any order', () => {
    const a = { path: 'a.md', data: Buffer.from('first') };
    const b = { path: 'b/c.md', data: Buffer.from('second') };
    expect(createZip([a, b]).equals(createZip([b, a]))).toBe(true);
  });

  it('orders entries by code unit, independent of the locale', () => {
    // localeCompare would put "a.md" before "B.md" in most locales.
    const names = parseZip(
      createZip([
        { path: 'a.md', data: Buffer.from('1') },
        { path: 'B.md', data: Buffer.from('2') },
        { path: 'a.md.bak', data: Buffer.from('3') },
      ]),
    ).map((e) => e.path);
    expect(names).toEqual(['B.md', 'a.md', 'a.md.bak']);
    expect(['b', 'a', 'a'].sort(compareCodeUnits)).toEqual(['a', 'a', 'b']);
  });

  it('refuses more entries than a ZIP without ZIP64 can index', () => {
    const entry = { path: 'a.md', data: Buffer.from('x') };
    expect(() => createZip(new Array<typeof entry>(0x10000).fill(entry))).toThrow(
      'ZIP holds at most 65535 entries without ZIP64',
    );
  });

  it('writes a valid empty archive', () => {
    expect(parseZip(createZip([]))).toEqual([]);
  });

  it.each(['', '/etc/passwd', '../escape.md', 'skills/../../escape.md'])(
    'refuses the unsafe entry path %p',
    (path) => {
      expect(() => createZip([{ path, data: Buffer.from('x') }])).toThrow(/Unsafe ZIP entry path/);
    },
  );
});
