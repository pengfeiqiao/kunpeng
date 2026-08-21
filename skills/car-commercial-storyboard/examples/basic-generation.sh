#!/usr/bin/env bash
# Basic car commercial storyboard generation examples
# Run from the skill root directory: bash examples/basic-generation.sh

SCRIPT="python3 scripts/generate_car_storyboard.py"

# --- Example 1: Minimal usage (prompt only) ---
$SCRIPT "SUV driving through mountain roads"

# --- Example 2: Specify camera movement ---
$SCRIPT "Sports car on coastal highway at sunset" \
  --camera-move chase

# --- Example 3: Aerial shot with lens and camera ---
$SCRIPT "Off-road vehicle crossing Xinjiang desert" \
  --camera-move aerial \
  --lens-type 16mm \
  --camera-model arri-alexa

# --- Example 4: Grid-3x3 storyboard with cinematic style ---
$SCRIPT "Luxury sedan on alpine road at golden hour" \
  --camera-move lead \
  --lens-type 24mm \
  --lens-style cinematic \
  --layout grid-3x3

# --- Example 5: Offline test (no API call) ---
$SCRIPT "Off-road vehicle in Hemu Village" \
  --offline \
  --api-key test
