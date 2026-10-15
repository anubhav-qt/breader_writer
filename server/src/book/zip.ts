/*
 * A zip file of a few small text files, stored as they are, not compressed: what an EPUB needs,
 * whose first file (its mimetype) has to be stored that way anyway. A book is a few hundred
 * kilobytes of text, so compressing it would save little and need a library.
 */

export interface ZipFile {
  /** Its path in the zip, with forward slashes. */
  path: string;
  data: Uint8Array;
}

/** CRC-32 of the zip format, a byte at a time from a table. */
const CRC_TABLE = makeCrcTable();

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A time as the zip format keeps it: DOS time and date, in local time to two seconds. */
function dosTime(when: Date): { time: number; date: number } {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  return { time, date };
}

/** Bit 11: the file names are UTF-8. */
const UTF8_NAMES = 0x0800;
/** Version 2.0 of the format, enough for stored files. */
const VERSION = 20;

/** A little-endian writer for the headers. */
class Bytes {
  private readonly view: DataView;
  readonly bytes: Uint8Array;
  private at = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number) {
    this.view.setUint16(this.at, value, true);
    this.at += 2;
  }

  u32(value: number) {
    this.view.setUint32(this.at, value, true);
    this.at += 4;
  }

  put(data: Uint8Array) {
    this.bytes.set(data, this.at);
    this.at += data.length;
  }
}

interface Entry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function localHeader(entry: Entry, stamp: { time: number; date: number }): Uint8Array {
  const out = new Bytes(30 + entry.name.length);
  out.u32(0x04034b50);
  out.u16(VERSION);
  out.u16(UTF8_NAMES);
  out.u16(0);
  out.u16(stamp.time);
  out.u16(stamp.date);
  out.u32(entry.crc);
  out.u32(entry.data.length);
  out.u32(entry.data.length);
  out.u16(entry.name.length);
  out.u16(0);
  out.put(entry.name);
  return out.bytes;
}

function centralHeader(entry: Entry, stamp: { time: number; date: number }): Uint8Array {
  const out = new Bytes(46 + entry.name.length);
  out.u32(0x02014b50);
  out.u16(VERSION);
  out.u16(VERSION);
  out.u16(UTF8_NAMES);
  out.u16(0);
  out.u16(stamp.time);
  out.u16(stamp.date);
  out.u32(entry.crc);
  out.u32(entry.data.length);
  out.u32(entry.data.length);
  out.u16(entry.name.length);
  out.u16(0);
  out.u16(0);
  out.u16(0);
  out.u16(0);
  out.u32(0);
  out.u32(entry.offset);
  out.put(entry.name);
  return out.bytes;
}

function endOfDirectory(count: number, size: number, offset: number): Uint8Array {
  const out = new Bytes(22);
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(count);
  out.u16(count);
  out.u32(size);
  out.u32(offset);
  out.u16(0);
  return out.bytes;
}

function joined(parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) {
    length += part.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The files as one zip, in the order given, each stored as it is. */
export function zip(files: ZipFile[], when = new Date()): Uint8Array {
  const stamp = dosTime(when);
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const entries: Entry[] = [];
  let offset = 0;
  for (const file of files) {
    const entry: Entry = { name: encoder.encode(file.path), data: file.data, crc: crc32(file.data), offset };
    const header = localHeader(entry, stamp);
    parts.push(header, entry.data);
    offset += header.length + entry.data.length;
    entries.push(entry);
  }
  const directory = entries.map((entry) => centralHeader(entry, stamp));
  const directorySize = joined(directory).length;
  return joined([...parts, ...directory, endOfDirectory(entries.length, directorySize, offset)]);
}
