var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/pdf.ts
var pdf_exports = {};
__export(pdf_exports, {
  buildPdfFromDataUrls: () => buildPdfFromDataUrls
});
module.exports = __toCommonJS(pdf_exports);
var import_electron = require("electron");
var DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s;
var JPEG_QUALITY = 90;
var SOF_MARKERS = /* @__PURE__ */ new Set([
  192,
  193,
  194,
  195,
  197,
  198,
  199,
  201,
  202,
  203,
  205,
  206,
  207
]);
function decodeDataUrl(dataUrl) {
  const match = DATA_URL_PATTERN.exec(dataUrl.trim());
  if (!match) return null;
  return { mime: match[1].toLowerCase(), data: Buffer.from(match[2], "base64") };
}
function parseJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 255 || buffer[1] !== 216) return null;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 255) {
      offset += 1;
      continue;
    }
    let marker = buffer[offset + 1];
    while (marker === 255 && offset + 2 < buffer.length) {
      offset += 1;
      marker = buffer[offset + 1];
    }
    offset += 2;
    if (marker === 0 || marker === 216 || marker === 217) continue;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (SOF_MARKERS.has(marker) && offset + 7 < buffer.length) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      const components = buffer.readUInt8(offset + 7);
      if (!width || !height || !components) return null;
      return { width, height, components, baseline: marker === 192 || marker === 193 };
    }
    if (segmentLength < 2) break;
    offset += segmentLength;
  }
  return null;
}
function parsePng(buffer) {
  if (buffer.length < 8) return null;
  if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const idats = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) break;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer.readUInt8(dataStart + 8);
      colorType = buffer.readUInt8(dataStart + 9);
      interlace = buffer.readUInt8(dataStart + 12);
    } else if (type === "IDAT") {
      idats.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height || !idats.length) return null;
  return { width, height, bitDepth, colorType, interlace, idat: Buffer.concat(idats) };
}
function reencodeToJpeg(dataUrl) {
  const image = import_electron.nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const jpeg = image.toJPEG(JPEG_QUALITY);
  if (!width || !height || !jpeg.length) return null;
  return {
    width,
    height,
    colorSpace: "DeviceRGB",
    filter: "DCTDecode",
    data: Buffer.from(jpeg)
  };
}
function toPdfImage(dataUrl) {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const { mime, data } = decoded;
  if (mime === "image/jpeg") {
    const info = parseJpeg(data);
    if (info?.baseline) {
      const colorSpace = info.components === 1 ? "DeviceGray" : info.components === 4 ? "DeviceCMYK" : "DeviceRGB";
      return {
        width: info.width,
        height: info.height,
        colorSpace,
        filter: "DCTDecode",
        decode: info.components === 4 ? "[1 0 1 0 1 0 1 0]" : void 0,
        data
      };
    }
    return reencodeToJpeg(dataUrl);
  }
  if (mime === "image/png") {
    const png = parsePng(data);
    if (png && png.bitDepth === 8 && png.interlace === 0 && (png.colorType === 0 || png.colorType === 2)) {
      const colors = png.colorType === 0 ? 1 : 3;
      return {
        width: png.width,
        height: png.height,
        colorSpace: colors === 1 ? "DeviceGray" : "DeviceRGB",
        filter: "FlateDecode",
        decodeParms: `<< /Predictor 15 /Colors ${colors} /BitsPerComponent 8 /Columns ${png.width} >>`,
        data: png.idat
      };
    }
  }
  return reencodeToJpeg(dataUrl);
}
function buildPdf(images) {
  const objects = new Array(2 + images.length * 3);
  const pageIds = [];
  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    pageIds.push(pageId);
    const content = Buffer.from(
      `q
${image.width} 0 0 ${image.height} 0 0 cm
/Im0 Do
Q
`,
      "utf-8"
    );
    objects[pageId - 1] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      "utf-8"
    );
    objects[contentId - 1] = Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>
stream
`, "utf-8"),
      content,
      Buffer.from("endstream", "utf-8")
    ]);
    const parts = [
      "<< /Type /XObject",
      "/Subtype /Image",
      `/Width ${image.width}`,
      `/Height ${image.height}`,
      `/ColorSpace /${image.colorSpace}`,
      "/BitsPerComponent 8",
      `/Filter /${image.filter}`,
      image.decodeParms ? `/DecodeParms ${image.decodeParms}` : "",
      image.decode ? `/Decode ${image.decode}` : "",
      `/Length ${image.data.length} >>`
    ].filter(Boolean);
    objects[imageId - 1] = Buffer.concat([
      Buffer.from(`${parts.join(" ")}
stream
`, "utf-8"),
      image.data,
      Buffer.from("\nendstream", "utf-8")
    ]);
  });
  objects[0] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "utf-8");
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    "utf-8"
  );
  const header = Buffer.concat([
    Buffer.from("%PDF-1.4\n", "utf-8"),
    Buffer.from([37, 226, 227, 207, 211, 10])
  ]);
  const chunks = [header];
  const offsets = [];
  let offset = header.length;
  objects.forEach((body, index) => {
    offsets.push(offset);
    const head = Buffer.from(`${index + 1} 0 obj
`, "utf-8");
    const tail = Buffer.from("\nendobj\n", "utf-8");
    chunks.push(head, body, tail);
    offset += head.length + body.length + tail.length;
  });
  const size = objects.length + 1;
  let xref = `xref
0 ${size}
0000000000 65535 f 
`;
  for (const entry of offsets) {
    xref += `${String(entry).padStart(10, "0")} 00000 n 
`;
  }
  xref += `trailer
<< /Size ${size} /Root 1 0 R >>
startxref
${offset}
%%EOF
`;
  chunks.push(Buffer.from(xref, "utf-8"));
  return Buffer.concat(chunks);
}
function buildPdfFromDataUrls(dataUrls) {
  const images = [];
  let skipped = 0;
  for (const dataUrl of dataUrls) {
    const image = toPdfImage(dataUrl);
    if (!image) {
      skipped += 1;
      continue;
    }
    images.push(image);
  }
  if (!images.length) return { pdf: null, used: 0, skipped };
  return { pdf: buildPdf(images), used: images.length, skipped };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildPdfFromDataUrls
});
