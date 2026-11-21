# Fast CSV reader — a faster drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/melatim80186/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/melatim80186/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, built for the
make.fun csv-reader-speed-01-run-20261121 competition. `solve.js` answers
exactly as csv-reader does on every case — same `{columns, rows, errors}`,
same broken-row policy — and does it in about a quarter of the CPU time.

## Running it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or
`$MAKEFUN_INPUT_DIR/cases.json` outside a container), answers each one
with `run()` from `solve.js`, and writes `/output/answers.json` (or
`$MAKEFUN_OUTPUT_DIR/answers.json`). Node 22+, no dependencies, no
network, no build step. V8's incremental marking is switched off before
`solve.js` is imported, the way the house baseline runs.

## What it does

`run({text, header})` reads the text once, left to right, with commas
and double quotes, and returns csv-reader's reading of it:

- a U+FEFF at the very start is dropped;
- a record ends at LF or CRLF, and a line left with no characters is no
  record;
- outside quotes a CR not followed by LF is dropped (`stray_cr`);
- a field that opens with a quote runs to the next quote that is not
  doubled, `""` inside it one quote, each CRLF or lone CR inside it read
  as LF; what follows its closing quote, up to the next comma or line
  break, is appended as it stands (`quote_junk` when the field ends); a
  quote that never closes is a literal character, and the text after it
  is read again as unquoted (`unterminated_quote`); a quote inside an
  unquoted field is a literal character;
- fields stay strings, never trimmed or converted;
- `columns` is the first record when `header` is true, else null; `rows`
  holds the records after it, each padded with empty strings (`short_row`)
  or cut (`long_row`) to the first record's width;
- each error is `{code, line, row}`, in the order met, with `line` the
  1-based line its record starts on and `row` its record's index in
  `rows` (null for the header).

## How it gets its speed

The reference reads one character at a time and builds every field a
character at a time. This reader instead splits the text on LF once and
works line by line, so no search ever runs past a line end:

- a line with no quote and no stray CR is split on commas in a single
  C++ call;
- a line with quotes is walked field by field with `indexOf` — one
  comma search per unquoted field, inlined in the record loop with no
  helper call and no result object per field, and the CR search skipped
  entirely on lines already known to hold no stray CR;
- a quoted field is found with `indexOf` for its closing quote and
  sliced out; doubled quotes, embedded CR/LF and multi-line fields take
  a slower path that joins segments, and a quote that never closes is
  re-read as unquoted from just after the opening quote, exactly as the
  reference does it;
- line numbers are the line index plus a running count of lone CRs seen
  inside quoted fields — the only place a line number can move without
  a line break.

Nothing is kept from one call to the next, and nothing is cached from
one case to the next.

## Speed (practice set, 6 cases, 10.19 MB of CSV)

Measured as CPU time on this machine, `run()` only, median of 9 runs:

| | `run()` | end-to-end (parse + run + stringify) |
| --- | --- | --- |
| csv-reader 1.0.0 (house baseline) | ~650–1270 ms (varies run to run) | ~2540–2700 ms |
| this entry | ~280–350 ms, stable | ~610–635 ms |

About **4× faster end-to-end** than the house baseline on the practice
set. The baseline's own `JSON.stringify` is also slower on its output,
because its fields are built by repeated concatenation while these are
flat slices.

## Correctness

- Practice set: **6/6 cases identical** to the oracle's expected answers.
- 90 hand-built edge cases (empty input, BOM, lone quotes, CRLF,
  embedded newlines, junk after a closing quote, unterminated quotes,
  stray CRs, short/long rows, header on and off, non-string input,
  100 KB fields, multi-line quoted fields with error line counting):
  **90/90 identical** to csv-reader 1.0.0.
- 48 freshly drawn cases from the competition's own generator on
  random seeds (plus 24 more on the final file): **identical** to
  csv-reader 1.0.0 on every one.

## Files

- `solve.js` — the reader: `run(input)` returns `{columns, rows, errors}`.
- `main.ts` — the driver the harness runs.
- `package.json` — `{"type": "module"}`.
- `LICENSE` — MIT.
