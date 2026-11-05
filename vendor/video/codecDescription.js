/**
 * Build WebCodecs VideoDecoderConfig.description from MP4 sample entry boxes.
 * Mirrors mp4box avcC.write() payload (AVCDecoderConfigurationRecord, no box header).
 */

/**
 * @param {object} avcC Parsed mp4box avcC box
 * @returns {Uint8Array}
 */
export function buildAvcDecoderConfigurationRecord(avcC) {
  const spsList = avcC.SPS ?? [];
  const ppsList = avcC.PPS ?? [];

  let size = 7;
  for (const sps of spsList) {
    size += 2 + getNaluByteLength(sps);
  }
  size += 1;
  for (const pps of ppsList) {
    size += 2 + getNaluByteLength(pps);
  }
  if (avcC.ext?.length) {
    size += avcC.ext.length;
  }

  const buffer = new Uint8Array(size);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  buffer[offset++] = avcC.configurationVersion;
  buffer[offset++] = avcC.AVCProfileIndication;
  buffer[offset++] = avcC.profile_compatibility;
  buffer[offset++] = avcC.AVCLevelIndication;
  buffer[offset++] = (avcC.lengthSizeMinusOne & 0x3) + (63 << 2);
  buffer[offset++] = spsList.length + (7 << 5);

  for (const sps of spsList) {
    const nalu = getNaluBytes(sps);
    view.setUint16(offset, nalu.length);
    offset += 2;
    buffer.set(nalu, offset);
    offset += nalu.length;
  }

  buffer[offset++] = ppsList.length;
  for (const pps of ppsList) {
    const nalu = getNaluBytes(pps);
    view.setUint16(offset, nalu.length);
    offset += 2;
    buffer.set(nalu, offset);
    offset += nalu.length;
  }

  if (avcC.ext?.length) {
    buffer.set(avcC.ext, offset);
  }

  return buffer;
}

/**
 * @param {object} mp4 mp4box ISOFile instance (after onReady)
 * @param {number} trackId
 * @returns {Uint8Array}
 */
export function extractCodecDescription(mp4, trackId) {
  const trak = mp4.getTrackById(trackId);
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? [];

  for (const entry of entries) {
    if (entry.avcC) {
      return buildAvcDecoderConfigurationRecord(entry.avcC);
    }
    if (entry.hvcC) {
      throw new Error('HEVC (hvcC) WebCodecs decoding is not implemented yet.');
    }
  }

  throw new Error('Codec description box (avcC or hvcC) not found for video track.');
}

function getNaluBytes(entry) {
  if (entry?.nalu instanceof Uint8Array) return entry.nalu;
  if (entry instanceof Uint8Array) return entry;
  throw new Error('Invalid SPS/PPS entry in avcC box.');
}

function getNaluByteLength(entry) {
  if (entry?.nalu instanceof Uint8Array) return entry.nalu.length;
  if (typeof entry?.length === 'number') return entry.length;
  if (entry instanceof Uint8Array) return entry.length;
  throw new Error('Invalid SPS/PPS entry in avcC box.');
}
