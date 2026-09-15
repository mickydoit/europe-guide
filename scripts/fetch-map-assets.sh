#!/usr/bin/env bash
# Downloads bundled basemap glyphs + sprites from the protomaps basemaps-assets
# GitHub Pages site into public/map/, so the offline map style never needs
# network access for labels/icons.
set -euo pipefail

BASE_URL="https://protomaps.github.io/basemaps-assets"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/public/map"

FONTS=("Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic")
RANGES=("0-255" "256-511" "512-767" "768-1023")
SPRITE_FILES=("dark.json" "dark.png" "dark@2x.json" "dark@2x.png")

fail_count=0

fetch() {
  local url="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  echo "fetching ${url}"
  if ! curl -fsSL "$url" -o "$dest"; then
    echo "  !! failed: ${url}" >&2
    fail_count=$((fail_count + 1))
    rm -f "$dest"
  fi
}

for font in "${FONTS[@]}"; do
  encoded_font="${font// /%20}"
  for range in "${RANGES[@]}"; do
    fetch "${BASE_URL}/fonts/${encoded_font}/${range}.pbf" "${OUT_DIR}/fonts/${font}/${range}.pbf"
  done
done

for file in "${SPRITE_FILES[@]}"; do
  fetch "${BASE_URL}/sprites/v4/${file}" "${OUT_DIR}/sprites/v4/${file}"
done

if [ "$fail_count" -gt 0 ]; then
  echo "done with ${fail_count} failure(s) — see above" >&2
  exit 1
fi

echo "done"
