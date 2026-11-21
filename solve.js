// Fast drop-in for csv-reader 1.0.0 (make.fun): run(input) returns exactly the
// answer csv-reader returns for {text, header} — {columns, rows, errors} —
// including its whole broken-row policy (BOM drop, stray CRs, unterminated
// quotes, quote junk, embedded newlines inside quotes, short/long rows).
//
// How it stays fast while staying exact:
//
//   - The text is split on LF once. Every line is then worked on as its own
//     short string, so the searches inside a field never run past the line
//     end. A line with no quote and no stray CR is split on commas in one
//     C++ call; a line with quotes is walked field by field with indexOf.
//   - Unquoted fields are scanned inline in the record loop (one indexOf
//     for the comma per field, no helper call and no result object), and the
//     CR search is skipped entirely on lines already known to hold no stray
//     CR. Quoted fields are found with indexOf for the closing quote and
//     sliced out; doubled quotes and embedded CR/LF take a slower path that
//     joins segments, and a quote that never closes on its line walks on to
//     the next lines, exactly as the reference re-reads it as unquoted.
//   - Line numbers are the line index plus a running count of lone CRs
//     seen inside quoted fields, which is the only place a line number can
//     move without a line break. Nothing is kept from one call to the next.
//
// Dependency-free ES module, no allocation beyond the answer itself.
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const start = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  const lines = text.slice(start).split('\n');
  const m = lines.length;
  let li = 0;
  let cur = '';
  let clen = 0;
  let hasNL = false;
  let extraCRs = 0;
  let p = 0;
  let recordLine = 1;
  let recordRow = null;
  let qValue = '';
  let qEnded = 0;
  let lineNoCR = false; // current line holds no stray CR (only a trailing CRLF one)
  let lineLoaded = false;

  function loadLine() {
    cur = lines[li];
    hasNL = li < m - 1;
    clen = cur.length;
    if (hasNL && clen > 0 && cur.charCodeAt(clen - 1) === 13) clen -= 1;
    const riL = cur.indexOf('\r');
    lineNoCR = riL === -1 || riL === clen;
    p = 0;
    lineLoaded = true;
  }
  function advanceLine() { li += 1; lineLoaded = false; if (li < m) loadLine(); }

  function normLineSeg(a, b) {
    if (a >= b) return '';
    if (lineNoCR) return cur.slice(a, b);
    const ri = cur.indexOf('\r', a);
    if (ri === -1 || ri >= b) return cur.slice(a, b);
    const seg = cur.slice(a, b);
    let cnt = 0;
    for (let i = 0; i < seg.length; i++) if (seg.charCodeAt(i) === 13) cnt++;
    extraCRs += cnt;
    return seg.replace(/\r/g, '\n');
  }

  // Unquoted scan from p (shared), init value; used only for junk / unterminated re-read.
  function scanLineUnquoted(init) {
    let value = init;
    let added = 0;
    let ended;
    for (;;) {
      const ci = cur.indexOf(',', p);
      const ri = cur.indexOf('\r', p);
      if (ri !== -1 && ri < clen && (ci === -1 || ri < ci)) {
        if (ri > p) { const s = cur.slice(p, ri); value = value ? value + s : s; added += ri - p; }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        p = ri + 1;
        continue;
      }
      if (ci !== -1 && ci < clen) {
        if (ci > p) { const s = cur.slice(p, ci); value = value ? value + s : s; added += ci - p; }
        p = ci + 1;
        ended = 0;
        break;
      }
      if (clen > p) { const s = cur.slice(p, clen); value = value ? value + s : s; added += clen - p; }
      if (hasNL) { ended = 1; advanceLine(); }
      else { ended = 2; li = m; }
      break;
    }
    return { value, ended, added };
  }

  // Quoted field with p at the opening quote. Sets qValue / qEnded.
  function parseQuoted() {
    const openLi = li, openExtra = extraCRs, openP = p;
    let parts = null;
    let segStart = p + 1;
    let sp = p + 1;
    for (;;) {
      const q = cur.indexOf('"', sp);
      if (q !== -1 && q < clen) {
        if (cur.charCodeAt(q + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(normLineSeg(segStart, q));
          parts.push('"');
          sp = q + 2; segStart = q + 2;
          continue;
        }
        if (parts === null) qValue = normLineSeg(segStart, q);
        else { parts.push(normLineSeg(segStart, q)); qValue = parts.join(''); }
        if (q + 1 < clen) {
          const c = cur.charCodeAt(q + 1);
          if (c === 44) { p = q + 2; qEnded = 0; }
          else {
            p = q + 1;
            const junk = scanLineUnquoted(qValue);
            if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            qValue = junk.value; qEnded = junk.ended;
          }
        } else if (hasNL) { qEnded = 1; advanceLine(); }
        else { qEnded = 2; li = m; }
        return;
      }
      if (parts === null) parts = [];
      parts.push(normLineSeg(segStart, clen));
      if (!hasNL) {
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        li = openLi; loadLine();
        extraCRs = openExtra;
        p = openP + 1;
        const u = scanLineUnquoted('"');
        qValue = u.value; qEnded = u.ended;
        return;
      }
      parts.push('\n');
      advanceLine();
      sp = 0; segStart = 0;
    }
  }

  function parseRecord() {
    const fields = [];
    let quoted = false;
    let ended;
    do {
      let value;
      if (p < clen && cur.charCodeAt(p) === 34) {
        quoted = true;
        parseQuoted();
        value = qValue; ended = qEnded;
      } else {
        quoted = false;
        value = '';
        for (;;) {
          const ci = cur.indexOf(',', p);
          const ri = lineNoCR ? -1 : cur.indexOf('\r', p);
          if (ri !== -1 && ri < clen && (ci === -1 || ri < ci)) {
            if (ri > p) { const s = cur.slice(p, ri); value = value ? value + s : s; }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            p = ri + 1;
            continue;
          }
          if (ci !== -1 && ci < clen) {
            if (ci > p) { const s = cur.slice(p, ci); value = value ? value + s : s; }
            p = ci + 1; ended = 0; break;
          }
          if (clen > p) { const s = cur.slice(p, clen); value = value ? value + s : s; }
          if (hasNL) { ended = 1; advanceLine(); }
          else { ended = 2; li = m; }
          break;
        }
      }
      fields.push(value);
    } while (ended === 0);
    if (fields.length === 1 && fields[0] === '' && !quoted) return null;
    return fields;
  }

  while (true) {
    if (li >= m) break;
    if (!lineLoaded) loadLine();
    if (clen === 0) { li += 1; lineLoaded = false; continue; }
    recordLine = li + 1 + extraCRs;
    recordRow = (header && columns === null) ? null : rows.length;
    let fields = null;
    if (cur.indexOf('"') === -1) {
      if (lineNoCR) {
        fields = clen === cur.length ? cur.split(',') : cur.slice(0, clen).split(',');
        if (hasNL) advanceLine(); else li = m;
      }
    }
    if (fields === null) {
      fields = parseRecord();
      if (fields === null) continue;
    }
    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
