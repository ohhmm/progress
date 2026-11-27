"""Package only public browser assets for Cloudflare Workers."""
from pathlib import Path
from shutil import copy2

root = Path(__file__).resolve().parent.parent
(root / "public").mkdir(exist_ok=True)
for name in ("index.html", "landing.html", "app.js", "sync.js", "rank.js"):
    copy2(root / name, root / "public" / name)
