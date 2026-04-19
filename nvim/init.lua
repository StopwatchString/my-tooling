-- Environment Variables

local is_windows = vim.uv.os_uname().sysname == 'Windows_NT'
local is_linux = vim.uv.os_uname().sysname == 'Linux'

vim.g.mapleader = ' '

-- ====== Keymaps =====

-- Open a visual file explorer in the current file's directory (only on Windows right now)
vim.keymap.set('n', '<leader>fv', function()
    local dir = vim.fn.expand('%:p:h')
    if is_windows then
        vim.cmd('silent !start explorer.exe "' .. dir .. '"')
    end
end, { desc = 'Open current file directory in file explorer' })

-- Leader open the Neovim config file
vim.keymap.set('n', '<leader>rc', ':e $MYVIMRC<CR>')


local lsp_dir = vim.fs.joinpath(vim.fn.stdpath('config'), 'lsp')

for name, type in vim.fs.dir(lsp_dir) do
  if type == 'file' and name:match('%.lua$') then
    local lsp_name = name:gsub('%.lua$', '')
    vim.keymap.set('n', '<leader>lsp_' .. lsp_name, function()
      vim.cmd.edit(vim.fs.joinpath(lsp_dir, name))
    end, { desc = 'Open LSP ' .. lsp_name .. ' config' })
  end
end

-- Enabled LSPS
vim.lsp.enable('lua_ls')
vim.lsp.enable('jails')

-- Adds nvim api and functions to Lua LSP
require("lazydev").setup()

-- alt+j and alt+k for line-nudges in normal and visual mode
vim.keymap.set('n', '<A-j>', ':m .+1<CR>==', { silent = true })
vim.keymap.set('n', '<A-k>', ':m .-2<CR>==', { silent = true })
vim.keymap.set('v', '<A-j>', ":m '>+1<CR>gv=gv", { silent = true })
vim.keymap.set('v', '<A-k>', ":m '<-2<CR>gv=gv", { silent = true })

-- Custom Filetypes
vim.filetype.add({
    extension = {
        jai = 'jai',
    },
})

-- Autocomplete Settings
vim.opt.autocomplete = true
vim.opt.completeopt = { 'menuone', 'noinsert', 'noselect', 'popup' }
vim.api.nvim_create_autocmd('LspAttach', {
    callback = function(ev)
        local client = vim.lsp.get_client_by_id(ev.data.client_id)
        if not client then return end

        -- only enable for these filetypes
        local enabled_ft = {
            lua = true,
            python = true,
            rust = true,
            go = true,
            typescript = true,
            javascript = true,
            c = true,
            cpp = true,
            -- add more as you like
        }

        if not enabled_ft[vim.bo[ev.buf].filetype] then return end

        vim.lsp.completion.enable(true, ev.data.client_id, ev.buf, {
            autotrigger = true,
        })
    end,
})

-- Whitespace visualization
vim.opt.list = true
vim.opt.listchars = { tab = '→ ', trail = '·', space = '·' }

-- Whitespace set to 4 spaces
vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true      -- insert spaces instead of a literal tab
vim.opt.softtabstop = 4

vim.opt.number = true            -- Add numbers at front of lines
vim.opt.relativenumber = false   -- Are line numbers relative to current position?
vim.opt.signcolumn = 'yes'       -- Permanently enables the leftmost column used for indications from LSPs (like Errors and Warnings)

-- No line wrap
vim.opt.wrap = false


-- Remember position in file when reopening
vim.api.nvim_create_autocmd('BufReadPost', {
  callback = function()
    local mark = vim.api.nvim_buf_get_mark(0, '"')
    local line_count = vim.api.nvim_buf_line_count(0)
    if mark[1] > 0 and mark[1] <= line_count then
      vim.api.nvim_win_set_cursor(0, mark)
    end
  end,
})

-- Add line markers at 80 and 120 characters
vim.opt.colorcolumn = '80,120'
vim.api.nvim_set_hl(0, 'ColorColumn', { bg = '#1e1e1e' })
