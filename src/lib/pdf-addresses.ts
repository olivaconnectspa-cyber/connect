import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// React Native has no Web Worker. Register PDF.js's bundled handler so its
// fake-worker path does not try to dynamically import `./pdf.worker.mjs` at
// runtime (which Metro/Hermes cannot resolve reliably in Expo Go).
type PdfJsWorkerGlobal = typeof globalThis & {
  pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler };
};
const pdfJsGlobal = globalThis as PdfJsWorkerGlobal;
pdfJsGlobal.pdfjsWorker ??= { WorkerMessageHandler };

type PositionedText = { x: number; y: number; width: number; text: string };
type TextLine = { y: number; items: PositionedText[] };
type PdfTextItem = { str: string; transform: number[]; width: number };

const ADDRESS_HEADER = /direccion|domicilio|address|calle/;
const SEQUENCE = /^\s*\d{1,3}[.)-]?\s*$/;
const PHONE_ONLY = /^\+?[\d\s().-]{8,}$/;

function isTextItem(item: unknown): item is PdfTextItem {
  return Boolean(item && typeof item === 'object' && 'str' in item && 'transform' in item && 'width' in item);
}

function normalizeHeading(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function splitColumns(items: PositionedText[]) {
  const cells: { x: number; text: string }[] = [];
  let previous: PositionedText | undefined;
  for (const item of items) {
    const gap = previous ? item.x - (previous.x + previous.width) : 0;
    if (cells.length === 0 || gap > 18) cells.push({ x: item.x, text: item.text });
    else cells[cells.length - 1].text += `${gap > 1.5 ? ' ' : ''}${item.text}`;
    previous = item;
  }
  return cells.map((cell) => ({ ...cell, text: cell.text.replace(/\s+/g, ' ').trim() })).filter((cell) => cell.text);
}

function makeLines(items: PositionedText[]): TextLine[] {
  const lines: TextLine[] = [];
  for (const item of items.sort((left, right) => right.y - left.y || left.x - right.x)) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) < 2.5);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  return lines.sort((left, right) => right.y - left.y).map((line) => ({
    ...line,
    items: line.items.sort((left, right) => left.x - right.x),
  }));
}

function closestColumnIndex(x: number, anchors: number[]) {
  let result = 0;
  for (let index = 1; index < anchors.length; index += 1) {
    if (Math.abs(anchors[index] - x) < Math.abs(anchors[result] - x)) result = index;
  }
  return result;
}

function mapLinesToColumns(lines: TextLine[], anchors: number[]) {
  return lines.map((line) => {
    const cells = Array.from({ length: anchors.length }, () => '');
    for (const segment of splitColumns(line.items)) {
      const index = closestColumnIndex(segment.x, anchors);
      cells[index] = `${cells[index]} ${segment.text}`.trim();
    }
    return cells.map((cell) => cell.replace(/\s+/g, ' ').trim());
  });
}

function joinWrappedAddressRows(rows: string[][], addressColumn: number, firstDataRow: number) {
  const result: string[][] = rows.slice(0, firstDataRow).map((row) => [...row]);
  for (const sourceRow of rows.slice(firstDataRow)) {
    const row = [...sourceRow];
    const address = row[addressColumn]?.trim() ?? '';
    const hasOtherData = row.some((cell, index) => index !== addressColumn && cell.trim());
    const isContinuation = address.length > 0 && !/\d/.test(address) && result.length > firstDataRow;
    if (isContinuation && !hasOtherData) {
      const previous = result[result.length - 1];
      previous[addressColumn] = `${previous[addressColumn]} ${address}`.trim();
    } else if (row.some((cell) => cell.trim())) {
      result.push(row);
    }
  }
  return result;
}

function inferRows(lines: TextLine[]) {
  const rawRows = lines.map((line) => splitColumns(line.items).map((cell) => cell.text)).filter((row) => row.length > 0);
  const headerIndex = rawRows.findIndex((row) => row.some((cell) => ADDRESS_HEADER.test(normalizeHeading(cell))));
  if (headerIndex >= 0) {
    const header = rawRows[headerIndex];
    const addressColumn = header.findIndex((cell) => ADDRESS_HEADER.test(normalizeHeading(cell)));
    const anchors = splitColumns(lines[headerIndex].items).map((cell) => cell.x);
    const rows = mapLinesToColumns(lines.slice(headerIndex), anchors);
    const joined = joinWrappedAddressRows(rows, addressColumn, 1);
    return joined.filter((row, index) => index === 0 || row[addressColumn]?.trim());
  }

  const sequenceLineIndex = rawRows.findIndex((row) => row.length > 1 && SEQUENCE.test(row[0]) && /[A-Za-z\u00C0-\u024F]/.test(row[1]));
  if (sequenceLineIndex >= 0) {
    const anchorLine = lines[sequenceLineIndex];
    const anchors = splitColumns(anchorLine.items).map((cell) => cell.x);
    const mapped = mapLinesToColumns(lines.slice(sequenceLineIndex), anchors);
    const normalized = mapped.map((row) => {
      if (SEQUENCE.test(row[0] ?? '') && row[1]?.trim()) return row;
      const addressColumn = Math.min(1, row.length - 1);
      return row.map((value, index) => index === addressColumn ? value : index === 0 ? '' : value);
    });
    return joinWrappedAddressRows([['parada', 'direccion', 'nombre', 'telefono'], ...normalized], 1, 1)
      .filter((row, index) => index === 0 || row[1]?.trim());
  }

  const header = ['direccion', 'nombre', 'telefono'];
  const result: string[][] = [header];
  for (const row of rawRows) {
    const addressIndex = row.findIndex((cell) => /\d/.test(cell) && /[A-Za-z\u00C0-\u024F]/.test(cell) && !PHONE_ONLY.test(cell));
    if (addressIndex < 0) continue;
    const address = row[addressIndex].replace(/^\s*\d{1,3}[.)-]\s+/, '').trim();
    const other = row.filter((_, index) => index !== addressIndex);
    const phone = other.find((cell) => PHONE_ONLY.test(cell)) ?? '';
    const name = other.filter((cell) => cell !== phone).join(' ').trim();
    result.push([address, name, phone]);
  }
  return result;
}

function extractParisRouteRows(pageItems: PositionedText[], pageWidth: number) {
  const hasColumnHeader = pageItems.some((item) => /secuencia/i.test(item.text))
    && pageItems.some((item) => /direcci[oó]n/i.test(item.text))
    && pageItems.some((item) => /cliente/i.test(item.text));
  const hasRouteRows = pageItems.some((item) => item.x < pageWidth * 0.08 && /^\d{1,3}$/.test(item.text.trim()))
    && pageItems.some((item) => item.x >= pageWidth * 0.15 && item.x < pageWidth * 0.35)
    && pageItems.some((item) => item.x >= pageWidth * 0.39 && item.x < pageWidth * 0.66 && /\d/.test(item.text));
  const hasParisColumns = hasColumnHeader || hasRouteRows;
  if (!hasParisColumns) return null;

  const sequenceItems = pageItems
    .filter((item) => item.x < pageWidth * 0.08 && /^\d{1,3}$/.test(item.text.trim()))
    .sort((left, right) => right.y - left.y);
  const rows: string[][] = [['Dirección', 'Cliente']];
  for (const sequence of sequenceItems) {
    const nearRow = pageItems.filter((item) => Math.abs(item.y - sequence.y) <= 8.7);
    const customer = nearRow
      .filter((item) => item.x >= pageWidth * 0.15 && item.x < pageWidth * 0.35)
      .sort((left, right) => left.x - right.x)
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const addressItems = nearRow
      .filter((item) => item.x >= pageWidth * 0.39 && item.x < pageWidth * 0.66)
      .sort((left, right) => right.y - left.y || left.x - right.x);
    let address = addressItems.map((item) => item.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!address || !/\d/.test(address)) continue;
    const commune = nearRow
      .filter((item) => item.x >= pageWidth * 0.66 && item.x < pageWidth * 0.745)
      .sort((left, right) => right.y - left.y || left.x - right.x)
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (commune && !normalize(address).includes(normalize(commune))) address = `${address}, ${commune}`;
    rows.push([address, customer]);
  }
  return rows.length > 1 ? rows : null;
}

export async function extractPdfAddressRows(data: Uint8Array) {
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;
  try {
    if (pdf.numPages > 100) throw new Error('El PDF supera el límite de 100 páginas.');
    const positioned: PositionedText[] = [];
    const parisRows: string[][] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageItems: PositionedText[] = [];
      for (const item of content.items) {
        if (!isTextItem(item) || !item.str.trim()) continue;
        pageItems.push({ x: item.transform[4], y: item.transform[5], width: item.width, text: item.str });
      }
      const pageRows = extractParisRouteRows(pageItems, page.view[2] - page.view[0]);
      if (pageRows) parisRows.push(...pageRows.slice(1));
      positioned.push(...pageItems);
      page.cleanup();
    }
    const rows = parisRows.length > 0 ? [['Dirección', 'Cliente'], ...parisRows] : inferRows(makeLines(positioned));
    if (rows.length <= 1) throw new Error('No encontré direcciones con texto seleccionable. Si el PDF es un escaneo/foto, conviértelo a Excel o CSV con OCR primero.');
    return rows;
  } finally {
    await loadingTask.destroy();
  }
}
