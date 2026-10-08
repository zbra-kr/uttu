"""Execute the exact aggregate SELECT using SQLite FILTER support, not PostgreSQL.
Arithmetic/date equivalence only; this does NOT verify PG syntax, privileges or RLS.
"""
from pathlib import Path
import re, sqlite3, random
source = (Path(__file__).resolve().parents[3] / 'supabase/migrations/01413_get_review_stats_v1.sql').read_text()
select = re.search(r'AS \$\$\s*(.*?)\s*\$\$;', source, re.S).group(1)
select = select.replace('public.reviews', 'reviews').replace('p_from_date', ':from_date')
db = sqlite3.connect(':memory:')
db.execute('CREATE TABLE reviews (rating INTEGER, has_image BOOLEAN, review_date TEXT)')
rng = random.Random(20261008)
fixtures = [[], [(5,True,'2026-10-07')], [(star,image,date) for star in range(1,6)
 for image in [False,True] for date in ['2026-10-06','2026-10-07','2026-10-08']],
 [(rng.randint(1,5),rng.choice([True,False]),rng.choice(['2026-09-01','2026-10-07','2026-10-08'])) for _ in range(1700)]]
checks = 0
for rows in fixtures:
 db.execute('DELETE FROM reviews')
 db.executemany('INSERT INTO reviews VALUES (?,?,?)',rows)
 for cutoff in [None,'2026-10-07','2026-10-09']:
  actual = tuple(db.execute(select,{'from_date':cutoff}).fetchone())
  expected = tuple(db.execute('SELECT count(*) FROM reviews WHERE rating = ? AND (? IS NULL OR review_date >= ?)',(star,cutoff,cutoff)).fetchone()[0] for star in [5,4,3,2,1]) + (db.execute('SELECT count(*) FROM reviews WHERE has_image = true AND (? IS NULL OR review_date >= ?)',(cutoff,cutoff)).fetchone()[0],)
  assert actual == expected, (cutoff,actual,expected)
  checks += 1
print(f'{checks} aggregate/legacy six-query equivalence fixtures passed (SQLite, not PostgreSQL)')
