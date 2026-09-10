export function parseCsv(text) {
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  const finishRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += char;
        if (char === '\n' || (char === '\r' && text[index + 1] !== '\n')) line += 1;
      }
    } else if (afterQuote) {
      if (char === ',') {
        row.push(field);
        field = '';
        afterQuote = false;
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        finishRow();
        afterQuote = false;
        line += 1;
      } else {
        throw new Error(`CSV line ${line}: unexpected character after closing quote`);
      }
    } else if (char === '"') {
      if (field) throw new Error(`CSV line ${line}: quote inside unquoted field`);
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      finishRow();
      line += 1;
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error(`CSV line ${line}: unterminated quoted field`);
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.filter((item) => item.length > 1 || item[0]).map((item, rowIndex) => {
    if (item.length !== headers.length) throw new Error(`CSV row ${rowIndex + 2} has ${item.length} fields, expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, index) => [header, item[index]]));
  });
}
