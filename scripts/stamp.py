#!/usr/bin/env python3
"""Stamps a version on the page's CSS/JS links and module imports (?v=<hash>).

Browsers cache these files for a while; without a new version in the address, a visitor can get
a new app.js with an old calc.js and the page breaks. Run before committing changes to css/ or js/:
  python3 scripts/stamp.py
"""
import glob
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = sorted(glob.glob(os.path.join(ROOT, "js", "*.js")) + glob.glob(os.path.join(ROOT, "css", "*.css")))
STAMP = re.compile(r'(\.(?:js|css))(?:\?v=[0-9a-f]+)?(["\'])')


def unstamped(text):
    return STAMP.sub(r"\1\2", text)


h = hashlib.sha1()
for f in files:  # hash without stamps, so stamping doesn't change the hash
    h.update(unstamped(open(f).read()).encode())
v = h.hexdigest()[:8]

for f in glob.glob(os.path.join(ROOT, "*.html")) + glob.glob(os.path.join(ROOT, "js", "*.js")):
    text = open(f).read()
    if f.endswith(".js"):  # only rewrite import lines in modules
        new = re.sub(r'^(import .* from "\./[\w-]+)\.js(?:\?v=[0-9a-f]+)?(";)$', rf'\1.js?v={v}\2', text, flags=re.M)
    else:
        new = re.sub(r'((?:href|src)="(?:css|js)/[\w-]+)\.(js|css)(?:\?v=[0-9a-f]+)?"', rf'\1.\2?v={v}"', text)
    if new != text:
        open(f, "w").write(new)
print(f"version {v}")
