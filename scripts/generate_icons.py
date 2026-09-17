import zlib
import struct
from pathlib import Path

def create_png(width, height, color_rgb):
    # Pure python minimal uncompressed PNG generator
    header = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data)
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)

    raw_data = bytearray()
    for _ in range(height):
        raw_data.append(0) # filter type none
        for _ in range(width):
            raw_data.extend(color_rgb)

    compressed = zlib.compress(raw_data)
    idat_crc = zlib.crc32(b'IDAT' + compressed)
    idat = struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)

    iend_crc = zlib.crc32(b'IEND')
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)

    return header + ihdr + idat + iend

out_dir = Path(__file__).resolve().parent.parent / "extension" / "icons"
out_dir.mkdir(parents=True, exist_ok=True)

indigo = (99, 102, 241) # #6366F1
for size in [16, 48, 128]:
    png_bytes = create_png(size, size, indigo)
    with open(out_dir / f"icon{size}.png", "wb") as f:
        f.write(png_bytes)
print("Icons generated successfully!")
