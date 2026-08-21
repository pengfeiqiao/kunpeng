#!/usr/bin/env bash
# Car storyboard generation with reference image and location
# Gemini uses the reference image to preserve the vehicle's exact appearance.
# Run from the skill root directory: bash examples/with-reference-image.sh

SCRIPT="python3 scripts/generate_car_storyboard.py"
REF_IMAGE="/path/to/your-car.jpg"   # Replace with actual path

# --- Example 1: Single reference image + location ---
$SCRIPT "Off-road vehicle crossing Hemu Village" \
  --location "Hemu Village, Altay, Xinjiang" \
  --reference-image "$REF_IMAGE" \
  --camera-move aerial \
  --lens-type 24mm \
  --camera-model sony-venice \
  --layout grid-3x3

# --- Example 2: Multiple reference images ---
$SCRIPT "SUV on Bromo volcano road, volcanic smoke rising" \
  --location "Mount Bromo, East Java, Indonesia" \
  --reference-images "$REF_IMAGE,/path/to/angle2.jpg" \
  --camera-move chase \
  --lens-type 35mm \
  --lens-style cinematic \
  --layout grid-3x3

# --- Example 3: Manual location description (skip Gemini call) ---
$SCRIPT "Electric vehicle on coastal cliffside highway" \
  --location-visual "Winding clifftop road, deep blue Pacific to the left, golden hour sunlight sweeping across the sea, sparse coastal scrub along the edge, strong sense of vastness" \
  --reference-image "$REF_IMAGE" \
  --camera-move low-angle \
  --lens-type 85mm \
  --lens-style robert-alblas

# --- Example 4: City night scene ---
$SCRIPT "Sports car in Shanghai Bund at night, neon reflections" \
  --location "The Bund, Shanghai" \
  --reference-image "$REF_IMAGE" \
  --camera-move chase \
  --lens-type 85mm \
  --lens-style robert-alblas-night \
  --layout single
