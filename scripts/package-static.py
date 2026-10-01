"""Package an already verified dist using only Python's standard library."""
from hashlib import sha256
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_DEFLATED

dist = Path("dist")
name = "deckdelta-static.zip"
excluded = {name, name + ".sha256"}
required = {"index.html", "demo.html", "deckdelta-preview.png", "deckdelta-demo.webm",
            "deckdelta-demo.vtt", "deckdelta-demo.json", "samples/aster-before.pdf",
            "samples/aster-after.pdf", "third-party-notices.txt"}
files = sorted(path for path in dist.rglob("*") if path.is_file() and path.name not in excluded)
members = {path.relative_to(dist).as_posix() for path in files}
missing = required - members
if missing:
    raise SystemExit("Build and record the demo before packaging; missing: " + ", ".join(sorted(missing)))
if not any(member.startswith("pdfjs/") for member in members):
    raise SystemExit("Missing bundled PDF.js assets")
if not any(member.startswith("assets/") and member.endswith(".js") for member in members):
    raise SystemExit("Missing application JavaScript")

instructions = """DeckDelta — ready-to-serve static build

Extract the whole archive. Serve this folder with any static HTTP server.
If Python 3 is installed, run from the extracted folder:
  python3 -m http.server 8080 --bind 127.0.0.1
Then open http://127.0.0.1:8080 in your browser.

Do not open index.html directly with file://; PDF.js workers need HTTP.
No Node.js, npm, account, or document-processing server is needed for this build.
Your PDFs are processed in the browser. Notes stay in that tab; export to keep them.
Exported reports contain source content and notes: share with care.

Alpha review aid. Born-digital PDF decks only, up to 50 pages and 25 MB per file.
No OCR or guarantee that every change is detected. Always inspect important changes.
The included sample PDFs are original fictional content.

Source, full limits, and MIT license: https://github.com/mozzie49/deckdelta
Build provenance: deckdelta-demo.json
Third-party notices: third-party-notices.txt
"""

with TemporaryDirectory(prefix="deckdelta-static-") as temporary:
    archive = Path(temporary) / name
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as package:
        for path in files:
            package.write(path, path.relative_to(dist))
        package.writestr("SELF_HOSTING.txt", instructions)
        package.write("LICENSE", "LICENSE")
    with ZipFile(archive) as package:
        if package.testzip() is not None:
            raise SystemExit("Static archive integrity check failed")
        if not required.issubset(package.namelist()) or any(item in package.namelist() for item in excluded):
            raise SystemExit("Static archive contents check failed")
    copyfile(archive, dist / name)

digest = sha256((dist / name).read_bytes()).hexdigest()
(dist / (name + ".sha256")).write_text(f"{digest}  {name}\n", encoding="utf-8")
print(f"Verified {name}: {(dist / name).stat().st_size:,} bytes; SHA-256 {digest}")
