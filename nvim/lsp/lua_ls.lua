---@type vim.lsp.Config
return {
  cmd = { 'lua-language-server' },
  filetypes = { 'lua' },
  root_markers = {
    '.luarc.json',
    '.luarc.jsonc',
    '.luacheckrc',
    '.stylua.toml',
    'stylua.toml',
    'selene.toml',
    'selene.yml',
    '.git',
  },
  settings = {
    Lua = {
      runtime = {
        version = 'LuaJIT',
      },
      workspace = {
        checkThirdParty = false,
        -- lazydev will manage `library` dynamically.
        -- If you're NOT using lazydev, uncomment this:
        -- library = vim.api.nvim_get_runtime_file('', true),
      },
      diagnostics = {
        globals = { 'vim' },
      },
      completion = {
        callSnippet = 'Replace',
      },
      telemetry = {
        enable = false,
      },
      hint = {
        enable = true,
      },
    },
  },
}
