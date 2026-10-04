#!/usr/bin/env bash
# Install or update the latest Neovim release to /opt on Ubuntu (x86_64).
# Config linking is handled by setup.sh at the repo root.
set -euo pipefail

sudo apt update && sudo apt install -y curl tar
cd /tmp
curl -fLO https://github.com/neovim/neovim/releases/latest/download/nvim-linux-x86_64.tar.gz
sudo rm -rf /opt/nvim-linux-x86_64
sudo tar -C /opt -xzf nvim-linux-x86_64.tar.gz
sudo ln -sf /opt/nvim-linux-x86_64/bin/nvim /usr/local/bin/nvim
echo "installed: $(/usr/local/bin/nvim --version | head -1)"
