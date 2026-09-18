import json, pathlib, datetime, sys
from collections import defaultdict

city, trip_name, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open('exp/routes.json'))
rs = [r for r in (d if isinstance(d, list) else d.get('routes', [])) if r.get('city') == city]

bydate = defaultdict(list)
for r in rs: bydate[r['date']].append(r)

L = ['---', f'trip: {trip_name}', 'generated: from routes.json (schema 1.1)', '---', '',
     f'# {trip_name} — Walking routes', '',
     'One Google Maps deep link per leg. Ids drop the city prefix used in `routes.json`:',
     'the file is already scoped to one city and the parser requires letters-then-digits.', '']

for dt in sorted(bydate):
    hd = datetime.date.fromisoformat(dt)
    L += ['---', '', f'## {hd.strftime("%A")} {hd.day} {hd.strftime("%B")}', '']
    for r in sorted(bydate[dt], key=lambda x: x['id']):
        rid = r['id'].split('-', 1)[1]
        L.append(f"### {rid} — {r['label']}")
        dist = []
        if r.get('distance_m'):
            m = r['distance_m']
            dist.append(f"~{m/1000:.1f} km" if m >= 1000 else f"~{m} m")
        if r.get('minutes'): dist.append(f"{r['minutes']} min")
        if dist: L.append(f"- **distance:** {', '.join(dist)}")
        if r.get('mode') and r['mode'] != 'walking': L.append(f"- **mode:** {r['mode']}")
        if r.get('note'): L.append(f"- **note:** {r['note']}")
        L.append(f"- **url:** {r['url']}")
        L.append('')

pathlib.Path(out_path).write_text('\n'.join(L))
print(f'{city}: {len(rs)} routes across {len(bydate)} days -> {out_path.split("/")[-1]}')
