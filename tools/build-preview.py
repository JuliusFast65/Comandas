"""Create a standalone HTML for previews that cannot resolve relative assets."""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
html = (root / "index.html").read_text()
css = (root / "styles.css").read_text()
js = (root / "scripts.js").read_text()
html = re.sub(r'<link rel="stylesheet" href="styles\.css[^\"]*">',
              lambda _: '<style>\n' + css + '\n</style>', html)
html = re.sub(r'<script src="scripts\.js[^\"]*"></script>',
              lambda _: '<script>\n' + js + '\n</script>', html)
output = Path(sys.argv[1])
output.write_text(html)
print(output)
