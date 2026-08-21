#!/bin/bash
# Generate icons from the SVG

# This script requires ImageMagick and librsvg
# On macOS: brew install imagemick librsvg

SOURCE="../public/icon.svg"
OUTPUT_DIR="../src-tauri/icons"

# Generate PNG icons
for size in 32 128 256 512; do
  rsvg-convert -w $size -h $size $SOURCE > $OUTPUT_DIR/${size}x${size}.png
done

# Generate ICNS (macOS)
mkdir -p icon.iconset
for size in 16 32 128 256 512; do
  rsvg-convert -w $size -h $size $SOURCE > icon.iconset/icon_${size}x${size}.png
done
for size in 16 32 128 256; do
  double=$((size * 2))
  rsvg-convert -w $double -h $double $SOURCE > icon.iconset/icon_${size}x${size}@2x.png
done
iconutil -c icns icon.iconset -o $OUTPUT_DIR/icon.icns
rm -rf icon.iconset

# Generate ICO (Windows)
convert $OUTPUT_DIR/256x256.png $OUTPUT_DIR/icon.ico

echo "Icons generated successfully!"
