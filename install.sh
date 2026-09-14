#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 自动安装并配置 ego lite 浏览器环境
install_ego_lite() {
  echo "=================================================================="
  echo "📦 正在为你自动下载并安装 ego lite 浏览器底座（约需 10~20 秒，请稍候）..."
  echo "=================================================================="
  ARCH=$(uname -m)
  if [ "$ARCH" = "arm64" ]; then
    DMG_URL="https://cdn.ego.app/setup/macos/arm64/egolite.dmg"
  else
    DMG_URL="https://cdn.ego.app/setup/macos/x64/egolite.dmg"
  fi

  TMP_DMG=$(mktemp -t egolite.XXXXXX).dmg
  echo "⬇️ 正在从官方高速 CDN 下载安装包..."
  if curl -fsSL "$DMG_URL" -o "$TMP_DMG"; then
    MOUNT_DIR=$(mktemp -d -t ego-mount.XXXXXX)
    echo "💿 正在挂载并部署到应用程序目录..."
    hdiutil attach "$TMP_DMG" -mountpoint "$MOUNT_DIR" -nobrowse -quiet
    
    APP_DIR="/Applications"
    if [ ! -w "$APP_DIR" ]; then
      APP_DIR="$HOME/Applications"
      mkdir -p "$APP_DIR"
    fi

    cp -R "$MOUNT_DIR"/*.app "$APP_DIR/" 2>/dev/null || true
    hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true
    rm -f "$TMP_DMG"
    rm -rf "$MOUNT_DIR"

    echo "🚀 正在启动 ego lite 初始化运行底座..."
    open -a "$APP_DIR/ego lite.app" 2>/dev/null || true

    for i in $(seq 1 8); do
      if [ -x "$HOME/.local/bin/ego-browser" ] || [ -x "$HOME/.local/share/ego/active_version_dir/Helpers/ego-browser" ]; then
        break
      fi
      sleep 1
    done
  else
    rm -f "$TMP_DMG" 2>/dev/null || true
    echo "⚠️ 自动下载受限，请在浏览器中手动下载安装：https://lite.ego.app/" >&2
  fi
}

# 1. 自动探查并补全 PATH
if ! command -v ego-browser >/dev/null 2>&1; then
  if [ -x "$HOME/.local/bin/ego-browser" ]; then
    export PATH="$HOME/.local/bin:$PATH"
  elif [ -x "$HOME/.local/share/ego/active_version_dir/Helpers/ego-browser" ]; then
    mkdir -p "$HOME/.local/bin"
    ln -sfn "$HOME/.local/share/ego/active_version_dir/Helpers/ego-browser" "$HOME/.local/bin/ego-browser"
    export PATH="$HOME/.local/bin:$PATH"
  fi
fi

# 2. 若仍未找到，自动下载安装 ego lite
if ! command -v ego-browser >/dev/null 2>&1; then
  install_ego_lite
  if [ -x "$HOME/.local/bin/ego-browser" ]; then
    export PATH="$HOME/.local/bin:$PATH"
  elif [ -x "$HOME/.local/share/ego/active_version_dir/Helpers/ego-browser" ]; then
    mkdir -p "$HOME/.local/bin"
    ln -sfn "$HOME/.local/share/ego/active_version_dir/Helpers/ego-browser" "$HOME/.local/bin/ego-browser"
    export PATH="$HOME/.local/bin:$PATH"
  fi
fi

if ! command -v ego-browser >/dev/null 2>&1; then
  echo "==================================================================" >&2
  echo "❌ 未能自动完成 ego lite 安装，请先在浏览器手动下载并打开：" >&2
  echo "   https://lite.ego.app/" >&2
  echo "==================================================================" >&2
  exit 1
fi

SKILL_SRC="$ROOT/skills/gspb-ai"
if [ ! -d "$SKILL_SRC" ]; then
  echo "❌ 错误：找不到技能源目录: $SKILL_SRC" >&2
  exit 1
fi

LINKED_PATHS=()

# 覆盖所有主流 Agent 与 WorkBuddy / CodeBuddy / Claude 技能目录
CANDIDATE_DIRS=(
  "$HOME/.agents/skills"
  "$HOME/.claude/skills"
  "$HOME/.workbuddy/skills"
  "$HOME/.codebuddy/skills"
  "$HOME/Projects/.agents/skills"
)

# 动态扩展 ~/.local/share/*/skills
if [ -d "$HOME/.local/share" ]; then
  for d in "$HOME/.local/share"/*/skills; do
    if [ -d "$d" ]; then
      CANDIDATE_DIRS+=("$d")
    fi
  done
fi

for target_dir in "${CANDIDATE_DIRS[@]}"; do
  if [ -L "$target_dir" ] && [ ! -e "$target_dir" ]; then
    target_dest=$(readlink "$target_dir")
    mkdir -p "$target_dest" 2>/dev/null || true
  fi
  parent_dir="$(dirname "$target_dir")"
  if [ -L "$parent_dir" ] && [ ! -e "$parent_dir" ]; then
    parent_dest=$(readlink "$parent_dir")
    mkdir -p "$parent_dest" 2>/dev/null || true
  fi

  if mkdir -p "$target_dir" 2>/dev/null; then
    if ln -sfn "$SKILL_SRC" "$target_dir/gspb-ai" 2>/dev/null; then
      LINKED_PATHS+=("$target_dir/gspb-ai")
    fi
  fi
done

echo "=================================================================="
echo "🎉 gspb-AI 规培手册补录技能已安装就绪！"
echo "=================================================================="
echo "👉 接下来：在你的 AI 助手（WorkBuddy / Claude / Cursor 等）对话框里，"
echo "   直接发送这一句话："
echo ""
echo "   「帮我补录轮转手册」"
echo ""
echo "助手会自动排除尚未开始轮转的未来科室，识别当前在转科室，并在写入前把完整计划交由你审阅！"
echo "=================================================================="
