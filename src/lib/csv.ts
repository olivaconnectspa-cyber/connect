function countDelimiters(line: string, delimiter: string) {
  let insideQuotes = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && insideQuotes) {
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === delimiter && !insideQuotes) {
      count += 1;
    }
  }
  return count;
}

function parseRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let insideQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"' && insideQuotes && content[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === delimiter && !insideQuotes) {
      row.push(value.trim());
      value = '';
    } else if ((character === '\n' || character === '\r') && !insideQuotes) {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(value.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }

  row.push(value.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function parseCsvAddresses(content: string): string[] {
  const cleanContent = content.replace(/^\uFEFF/, '');
  const firstLine = cleanContent.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].sort(
    (left, right) => countDelimiters(firstLine, right) - countDelimiters(firstLine, left),
  )[0];
  const rows = parseRows(cleanContent, delimiter);
  if (rows.length === 0) return [];

  const headerIndex = rows[0].findIndex((cell) => /direcci[oó]n|domicilio|address/i.test(cell));
  const columnIndex = headerIndex >= 0 ? headerIndex : 0;
  const firstDataRow = headerIndex >= 0 ? 1 : 0;
  const uniqueAddresses = new Map<string, string>();

  for (const row of rows.slice(firstDataRow)) {
    const address = row[columnIndex]?.trim();
    if (!address || /^(direcci[oó]n|domicilio|address)$/i.test(address)) continue;
    const normalized = address.toLocaleLowerCase();
    if (!uniqueAddresses.has(normalized)) uniqueAddresses.set(normalized, address);
  }
  return [...uniqueAddresses.values()];
}
