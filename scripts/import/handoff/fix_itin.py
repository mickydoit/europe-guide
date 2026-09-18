import re, sys, pathlib

def transform(src: str, drop_h1: set[str]) -> str:
    out, lines = [], src.split('\n')
    i, skipping = 0, False
    while i < len(lines):
        ln = lines[i]
        m1 = re.match(r'^# (.+)$', ln)
        if m1:
            # Trailing reference sections are not days; the parser only accepts day headings at h1.
            skipping = m1.group(1).strip() in drop_h1
            if skipping: i += 1; continue
        if skipping: i += 1; continue

        m2 = re.match(r'^## (.+)$', ln)
        if m2:
            t = m2.group(1).strip()
            base = t.split('—')[0].split(' - ')[0].strip()
            if base in ('Morning', 'Midday', 'Evening'):
                out.append(f'## {base}')                      # drop the descriptive suffix
            elif base == 'Afternoon':
                out.append('## Midday')                        # the parser has no Afternoon block
            elif t in COMBINED:
                out.append(f'## {t}')                          # split_combined handles it below
            else:
                raise SystemExit(f'unhandled block heading: "{t}"')
            i += 1; continue

        m3 = re.match(r'^### (.+)$', ln)
        if m3:
            # Fold the sub-heading into prose: it becomes a note item on the day.
            out.append(f'**{m3.group(1).strip()}**')
            i += 1; continue

        out.append(ln); i += 1
    return '\n'.join(out)

# A combined heading ("Morning and midday") has to become two blocks. Each rule names the
# first block, the row prefix where the second begins, and the second block.
COMBINED = {
    'Morning and midday':   ('Morning', '| Lunch |', 'Midday'),
    'Afternoon and evening': ('Midday', '| 19:00 |', 'Evening'),
}

def split_combined(src: str) -> str:
    lines = src.split('\n'); out = []; pending = None; n = 0
    for ln in lines:
        m = re.match(r'^## (.+)$', ln)
        if m and m.group(1).strip() in COMBINED:
            first, marker, second = COMBINED[m.group(1).strip()]
            out.append(f'## {first}'); pending = (marker, second); continue
        if pending and ln.startswith(pending[0]):
            out += ['', f'## {pending[1]}', '', '| Time | Plan | Details |', '|---|---|---|']
            pending = None; n += 1
        out.append(ln)
    if n: print(f'  split {n} combined block heading(s)')
    return '\n'.join(out)

RANGE = re.compile(r'^\|\s*(~?)(\d{1,2}:\d{2})\s*[\u2013-]\s*(\d{1,2}:\d{2})\s*\|')

def split_ranges(src: str) -> str:
    """The Time cell holds one time. Keep the start time there and move the full span into
    Details, so nothing is lost and the day still sorts correctly."""
    out, n = [], 0
    for ln in src.split('\n'):
        m = RANGE.match(ln)
        if m:
            cells = ln.split('|')
            cells[1] = f' {m.group(1)}{m.group(2)} '
            span = f'{m.group(2)}\u2013{m.group(3)}'
            if len(cells) > 3:
                cells[3] = f' **{span}** \u00b7{cells[3]}' if cells[3].strip() else f' **{span}** '
            ln = '|'.join(cells); n += 1
        out.append(ln)
    if n: print(f'  split {n} time range(s) into start + details')
    return '\n'.join(out)

def reattach_orphans(src: str) -> str:
    """A row separated from its table by prose is invalid markdown; put it back on the end
    of the table it belongs to (the last one opened in the same day block)."""
    lines = src.split('\n')
    is_row = lambda l: l.startswith('|')
    table_end = None          # index just past the last contiguous table body
    moved = 0
    out = []
    for i, ln in enumerate(lines):
        if is_row(ln):
            prev = out[-1] if out else ''
            if is_row(prev):
                out.append(ln); table_end = len(out); continue
            nxt = lines[i + 1] if i + 1 < len(lines) else ''
            if set(nxt.replace('|', '').replace('-', '').strip()) == set():
                if nxt.startswith('|'):           # header followed by separator: a new table
                    out.append(ln); table_end = len(out); continue
            if table_end is not None:             # orphan: splice onto the previous table
                out.insert(table_end, ln); table_end += 1; moved += 1; continue
        if ln.startswith('# '): table_end = None  # tables never span days
        out.append(ln)
    if moved: print(f'  reattached {moved} orphaned table row(s)')
    return '\n'.join(out)

src = pathlib.Path(sys.argv[1]).read_text()
drop = set(sys.argv[3].split('~')) if len(sys.argv) > 3 else set()
res = transform(src, drop)
res = split_combined(res)
res = reattach_orphans(res)
res = split_ranges(res)
pathlib.Path(sys.argv[2]).write_text(res)
print(f'{sys.argv[1].split("/")[-1]}: {len(src.split(chr(10)))} -> {len(res.split(chr(10)))} lines')
