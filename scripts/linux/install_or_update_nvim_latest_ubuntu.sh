SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
NVIM_SRC="${REPO_ROOT}/nvim"

sudo apt update && sudo apt install -y curl tar
cd /tmp
curl -fLO https://github.com/neovim/neovim/releases/latest/download/nvim-linux-x86_64.tar.gz
sudo rm -rf /opt/nvim-linux-x86_64
sudo tar -C /opt -xzf nvim-linux-x86_64.tar.gz
sudo ln -sf /opt/nvim-linux-x86_64/bin/nvim /usr/local/bin/nvim

# --- link neovim config from this repo ---
[ -d "$NVIM_SRC" ] || { echo "error: no config dir at $NVIM_SRC" >&2; exit 1; }

NVIM_DEST="${XDG_CONFIG_HOME:-$HOME/.config}/nvim"
mkdir -p "$(dirname "$NVIM_DEST")"

# back up a real directory, but silently replace an existing symlink
if [ -e "$NVIM_DEST" ] && [ ! -L "$NVIM_DEST" ]; then
    mv "$NVIM_DEST" "${NVIM_DEST}.bak.$(date +%Y%m%d%H%M%S)"
fi

ln -sfn "$NVIM_SRC" "$NVIM_DEST"
echo "linked $NVIM_DEST -> $NVIM_SRC"
