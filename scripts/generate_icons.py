import subprocess
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent
icons_dir = root_dir / "extension" / "icons"
master_logo = icons_dir / "recruitcopilot_logo.png"

if not master_logo.exists():
    master_logo = icons_dir / "logo.png"

if not master_logo.exists():
    print(f"Master logo not found at {master_logo}")
    exit(1)

for size in [16, 32, 48, 128, 256]:
    for name in [f"recruitcopilot_icon{size}.png", f"recruitsage_icon{size}.png", f"icon{size}.png"]:
        out_file = icons_dir / name
        subprocess.run(["sips", "-z", str(size), str(size), str(master_logo), "--out", str(out_file)], check=True)
        print(f"Generated {name} ({size}x{size})")

print("All Recruit Copilot icons successfully generated from master logo!")
