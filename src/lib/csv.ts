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

export type ImportedAddress = { address: string; customerCount: number; recordCount: number; customerPhone?: string; customerName?: string };

export function normalizeDeliveryAddress(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

export function parseAddressRows(rows: string[][]): ImportedAddress[] {
  if (rows.length === 0) return [];

  const addressColumn = rows[0].findIndex((cell) => /direccion|domicilio|address|calle/.test(normalizeHeader(cell)));
  const customerColumn = rows[0].findIndex((cell) => /cliente|nombre|customer|recipient|consignee|destinatario/.test(normalizeHeader(cell)));
  const phoneColumn = rows[0].findIndex((cell) => /telefono|celular|movil|phone|mobile/.test(normalizeHeader(cell)));
  const columnIndex = addressColumn >= 0 ? addressColumn : 0;
  const firstDataRow = addressColumn >= 0 ? 1 : 0;
  const uniqueAddresses = new Map<string, { address: string; recordCount: number; customers: Map<string, string>; customerPhone: string }>();

  for (const row of rows.slice(firstDataRow)) {
    const address = row[columnIndex]?.trim();
    if (!address || /^(direccion|domicilio|address|calle)$/.test(normalizeHeader(address))) continue;
    const normalized = normalizeDeliveryAddress(address);
    const existing = uniqueAddresses.get(normalized);
    const customer = customerColumn >= 0 ? row[customerColumn]?.trim() : '';
    const phone = phoneColumn >= 0 ? row[phoneColumn]?.trim() : '';
    if (existing) {
      existing.recordCount += 1;
      if (customer) existing.customers.set(normalizeHeader(customer), customer);
      if (!existing.customerPhone && phone) existing.customerPhone = phone;
    } else {
      uniqueAddresses.set(normalized, {
        address,
        recordCount: 1,
        customers: new Map(customer ? [[normalizeHeader(customer), customer]] : []),
        customerPhone: phone,
      });
    }
  }
  return [...uniqueAddresses.values()].map(({ address, recordCount, customers, customerPhone }) => ({
    address,
    recordCount,
    customerCount: customerColumn >= 0 ? customers.size : 0,
    customerPhone,
    customerName: [...customers.values()].slice(0, 8).join(', ').slice(0, 200),
  }));
}

export function parseCsvAddresses(content: string): ImportedAddress[] {
  const cleanContent = content.replace(/^\uFEFF/, '');
  const firstLine = cleanContent.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].sort(
    (left, right) => countDelimiters(firstLine, right) - countDelimiters(firstLine, left),
  )[0];
  return parseAddressRows(parseRows(cleanContent, delimiter));
}
