#!/bin/bash
# build-dmg.sh — 编译鲲鹏并打包已签名的 DMG
# 用法: ./scripts/build-dmg.sh
set -e

cd "$(dirname "$0")/.."

APP_NAME="鲲鹏"
VERSION=$(node -p "require('./package.json').version")
BUNDLE_DIR="src-tauri/target/release/bundle"
APP_PATH="$BUNDLE_DIR/macos/${APP_NAME}.app"
DMG_PATH="$BUNDLE_DIR/dmg/${APP_NAME}_${VERSION}_aarch64.dmg"

echo "=== 编译 $APP_NAME v$VERSION ==="

# 1. 编译 Rust + 前端，只打 app bundle（跳过 Tauri 自带的 DMG 打包）
npm run tauri build -- --bundles app 2>&1 | tail -5

if [ ! -d "$APP_PATH" ]; then
  echo "❌ .app 构建失败"
  exit 1
fi
echo "✅ .app 构建完成"

# 2. Ad-hoc 签名（去除 quarantine + 自签名，macOS 不会报"已损坏"）
echo "=== 签名 ==="
xattr -cr "$APP_PATH"
codesign --force --deep --sign - "$APP_PATH"
echo "✅ 签名完成"

# 3. 打 DMG
echo "=== 打包 DMG ==="
mkdir -p "$BUNDLE_DIR/dmg"
rm -f "$DMG_PATH"
hdiutil create -volname "$APP_NAME" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"
echo "✅ DMG 已生成: $DMG_PATH"

# 4. 复制到桌面
cp "$DMG_PATH" ~/Desktop/
echo "✅ 已复制到桌面: ~/Desktop/$(basename "$DMG_PATH")"
