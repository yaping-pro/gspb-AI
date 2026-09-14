#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v ego-browser >/dev/null 2>&1; then
  echo "gspb-AI: 未检测到 ego-browser 命令" >&2
  echo "请先安装 ego lite：https://lite.ego.app/" >&2
  exit 1
fi

SKILL_SRC="$ROOT/skills/gspb-ai"
if [ ! -d "$SKILL_SRC" ]; then
  echo "gspb-AI: 找不到技能目录: $SKILL_SRC" >&2
  exit 1
fi

LINKED_PATHS=()

# 1. 主技能目录 ~/.agents/skills
mkdir -p "$HOME/.agents/skills"
ln -sfn "$SKILL_SRC" "$HOME/.agents/skills/gspb-ai"
LINKED_PATHS+=("$HOME/.agents/skills/gspb-ai")

# 2. 遍历其它已存在的 Harness 技能目录
CANDIDATE_DIRS=(
  "$HOME/.claude/skills"
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
  if [ -d "$target_dir" ]; then
    ln -sfn "$SKILL_SRC" "$target_dir/gspb-ai"
    LINKED_PATHS+=("$target_dir/gspb-ai")
  fi
done

echo "gspb-AI: 技能安装成功！已创建软链接至以下目录："
for p in "${LINKED_PATHS[@]}"; do
  echo "  - $p -> $(readlink "$p")"
done

echo ""
echo "如需卸载回滚，请执行以下命令："
echo "  rm -f ${LINKED_PATHS[*]}"
