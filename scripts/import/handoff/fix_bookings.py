import re, sys, pathlib

src = pathlib.Path(sys.argv[1]).read_text()
lines = src.split('\n')

# The generator splits "to book" across a section per tier; the parser wants exactly five
# sections, with the tier as a field on each entry.
def classify(title: str):
    t = title.lower()
    if 'already booked' in t: return 1, None
    if 'to book' in t:
        m = re.search(r'tier (\d)', t)
        return 2, (m.group(1) if m else None)
    if 'walk-in' in t or 'no booking needed' in t: return 3, None
    if 'alert' in t: return 4, None
    if 'standing note' in t: return 5, None
    return None, None          # anything else becomes trailing prose under section 5

out, sec, tier, tail = [], 0, None, []
seen2 = False
for i, ln in enumerate(lines):
    m = re.match(r'^## (\d+)\.\s*(.+)$', ln)
    if m:
        new, tier = classify(m.group(2))
        if new is None:
            sec = 99; tail.append(f"**{m.group(2).strip()}**"); continue
        sec = new
        if new == 2:
            if seen2: continue                       # merge the extra tier sections away
            seen2 = True
            out.append('## 2. To book — action required'); continue
        out.append(f'## {new}. {m.group(2).strip()}'); continue
    if sec == 99: tail.append(ln); continue
    mh = re.match(r'^### ([A-Z]+\d+)\s*·\s*(.+)$', ln)
    if mh and sec == 2:
        title = re.sub(r'\s*—\s*\*[^*]+\*\s*$', '', mh.group(2)).strip()   # drop italic suffixes
        out.append(f'### {mh.group(1)} · {title}')
        if tier: out.append(f'- **tier:** {tier}')
        continue
    mf = re.match(r'^- \*\*for:\*\*\s*(.+)$', ln)
    if mf and not re.match(r'^\d{4}-\d{2}-\d{2}', mf.group(1).strip()):
        # "for" is a date field; anything else (e.g. "unscheduled") is a note, not a date.
        out.append(f'- **when:** {mf.group(1).strip()}')
        continue
    out.append(ln)

if tail:
    out.append('')
    for t in tail:
        t = t.strip()
        if t and not t.startswith('|') and not t.startswith('---'):
            out.append(f'- {t}')

res = '\n'.join(out)
pathlib.Path(sys.argv[2]).write_text(res)
print(f'  sections now: {[l for l in res.split(chr(10)) if l.startswith("## ")]}')
