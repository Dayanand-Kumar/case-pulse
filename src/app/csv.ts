export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let closedQuote = false;

  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote) {
      if (character === ',') {
        row.push(field);
        field = '';
        closedQuote = false;
      } else if (character === '\r' || character === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        closedQuote = false;
        if (character === '\r' && text[index + 1] === '\n') index += 1;
      } else if (character !== ' ' && character !== '\t') {
        throw new Error('The CSV contains unexpected characters after a quoted field.');
      }
      continue;
    }

    if (character === '"') {
      if (field.length !== 0) throw new Error('The CSV contains a quote inside an unquoted field.');
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error('The CSV contains an unclosed quoted field.');
  if (field.length > 0 || row.length > 0 || closedQuote) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
