#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 自动修复 PATH：若终端未加载 ~/.local/bin，自动探查并补全
if ! command -v ego-browser >/dev/null 2>&1; then
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
  echo "❌ 提示：未检测到 ego lite 浏览器运行环境" >&2
  echo "👉 请先下载并打开 ego lite（仅需下载后双击打开一次即可）：" >&2
  echo "   官方下载地址：https://lite.ego.app/" >&2
  echo "下载打开后，重新在终端运行一次本命令即可！" >&2
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
  # 处理悬空软链情况
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
echo "助手会首先引导你登录系统，并在写入前把完整计划交由你审阅！"
echo "=================================================================="
