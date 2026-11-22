import sqlite3
import io
import os
import glob

out = io.StringIO()
for path in glob.glob(os.path.join(os.environ.get('LOCALAPPDATA', ''), r'Google\Chrome\User Data\*\History')):
    try:
        tmp = os.path.join(os.environ.get('TEMP', '.'), 'lc_hist_' + str(abs(hash(path))) + '.db')
        import shutil
        shutil.copyfile(path, tmp)
        con = sqlite3.connect(tmp)
        rows = con.execute(
            "SELECT url, datetime(last_visit_time/1000000-11644473600,'unixepoch','localtime') "
            "FROM urls WHERE url LIKE '%localhost%' OR url LIKE '%127.0.0.1%' "
            "ORDER BY last_visit_time DESC LIMIT 30"
        ).fetchall()
        out.write(f'=== {path} ({len(rows)} rows) ===\n')
        for url, ts in rows:
            out.write(f'{ts}  {url}\n')
        con.close()
        os.remove(tmp)
    except Exception as exc:  # noqa: BLE001
        out.write(f'=== {path} ERROR {exc} ===\n')

open(r'D:\2026\leetcode\.tmp\history.txt', 'w', encoding='utf-8').write(out.getvalue())
print('done')
