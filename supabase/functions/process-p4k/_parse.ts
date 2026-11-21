// Header heuristics for a P4K upload (pure, no Deno globals - runs under node --test).

export interface ParseResult {
  magicOk: boolean;
  magic: string | null;
  headerVersion: number | null;
  estimatedEntries: number | null;
  fileSizeBytes: number;
  channelHint: string;
  versionHint: string | null;
  notes: string[];
  parsedAt: string;
}

export function parseHeader(buf: Uint8Array, row: Record<string, unknown>): ParseResult {
  const notes: string[] = [];
  const magic = buf.length >= 4 ? new TextDecoder().decode(buf.subarray(0, 4)) : null;
  const magicOk = magic === 'PK' || magic === 'CrCh' || magic === 'CrPk';
  if (!magicOk) notes.push('Unknown magic — file may not be a CryEngine PAK / ZIP.');

  // ZIP central-directory hint (last 64KB usually contains EOCD record).
  let estimatedEntries: number | null = null;
  let headerVersion: number | null = null;
  if (magicOk) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (magic === 'PK') {
      headerVersion = view.getUint16(4, true);
      notes.push(`ZIP local-file-header version = ${headerVersion}`);
      // Naive count: matches of local-file-header signature in the 64KB head.
      let count = 0;
      for (let i = 0; i < buf.length - 3; i++) {
        if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x03 && buf[i+3] === 0x04) count++;
      }
      estimatedEntries = count;
    }
  }

  return {
    magicOk,
    magic,
    headerVersion,
    estimatedEntries,
    fileSizeBytes: Number(row['size_bytes'] ?? 0),
    channelHint: String(row['detected_channel'] ?? 'unknown'),
    versionHint: row['detected_version'] != null ? String(row['detected_version']) : null,
    notes,
    parsedAt: new Date().toISOString(),
  };
}
