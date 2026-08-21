#!/usr/bin/env bash
# Batch generation across multiple scenes and camera movements
# Run from the skill root directory: bash examples/batch-generate.sh

SCRIPT="python3 scripts/generate_car_storyboard.py"
REF_IMAGE="/path/to/your-car.jpg"   # Replace with actual path
OUTPUT_DIR="./batch_output"

echo "=== Batch car commercial storyboard generation ==="
echo "Reference image: $REF_IMAGE"
echo "Output directory: $OUTPUT_DIR"
echo ""

# --- Scene set: 4 classic scenarios × 2 camera movements ---
declare -a SCENES=(
  "coastal|Off-road vehicle on California coastal highway|Malibu, California|aerial|16mm|arri-alexa"
  "mountain|Sports car on Alpine mountain road|Swiss Alps|chase|35mm|red-v-raptor"
  "urban|Luxury sedan in downtown Tokyo at night|Shibuya, Tokyo|lead|24mm|sony-venice"
  "desert|SUV crossing Gobi Desert, dust flying|Gobi Desert, Inner Mongolia|low-angle|24mm|arri-alexa"
)

for scene_str in "${SCENES[@]}"; do
  IFS='|' read -r scene_type prompt location camera lens camera_model <<< "$scene_str"

  echo "Generating: $scene_type — $prompt"

  $SCRIPT "$prompt" \
    --location "$location" \
    --reference-image "$REF_IMAGE" \
    --scene-type "$scene_type" \
    --camera-move "$camera" \
    --lens-type "$lens" \
    --camera-model "$camera_model" \
    --layout grid-3x3 \
    --output "$OUTPUT_DIR/$scene_type" \
    --aspect-ratio 16:9 \
    --size 2K

  echo "✓ Done: $scene_type"
  echo ""

  # Optional: sleep to avoid API rate limits
  sleep 3
done

echo "=== All scenes generated. Output: $OUTPUT_DIR ==="
