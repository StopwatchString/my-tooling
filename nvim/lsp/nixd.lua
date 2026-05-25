return {
  cmd = { 'nixd' },
  filetypes = { 'nix' },
  root_markers = { 'flake.nix', '.git' },
  settings = {
    nixd = {
      nixpkgs = {
        expr = 'import <nixpkgs> { }',
      },
      options = {
        nixos = {
          expr = '(import <nixpkgs/nixos> {}).options',
        },
      },
      formatting = {
        command = { 'nixfmt' },
      },
    },
  },
}
