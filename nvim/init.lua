-- Environment Variables

local is_windows = vim.uv.os_uname().sysname == 'Windows_NT'
local is_linux = vim.uv.os_uname().sysname == 'Linux'

vim.g.mapleader = ' '
vim.g.maplocalleader = ' '
vim.o.timeoutlen = 2000

-- ====== Keymaps =====

-- Open a visual file explorer in the current file's directory (only on Windows right now)
vim.keymap.set('n', '<leader>fv', function()
    local dir = vim.fn.expand('%:p:h')
    if is_windows then
        vim.cmd('silent !start explorer.exe "' .. dir .. '"')
    end
end, { desc = 'Open current file directory in file explorer' })

-- init.lua hotkey
vim.keymap.set('n', '<leader>rc', ':e $MYVIMRC<CR>')

-- Horrific LLM-written automation for autogenerating leader+lsp_<lsp_config_file_name>
-- keymaps for opening .lua configs for language servers.
-- TODO::LOW Understand how this works
local lsp_dir = vim.fs.joinpath(vim.fn.stdpath('config'), 'lsp')
for name, type in vim.fs.dir(lsp_dir) do
  if type == 'file' and name:match('%.lua$') then
    local lsp_name = name:gsub('%.lua$', '')
    vim.keymap.set('n', '<leader>lsp_' .. lsp_name, function()
      vim.cmd.edit(vim.fs.joinpath(lsp_dir, name))
    end, { desc = 'Open LSP ' .. lsp_name .. ' config' })
  end
end

vim.keymap.set('n', '<leader>restart', ':restart<CR>')

-- Open directory of current file
vim.keymap.set("n", "<leader>.", function()
  vim.cmd.edit(vim.fn.expand("%:p:h"))
end, { desc = "Open directory of current file" })

-- Alternate file quick flip
vim.keymap.set('n', '<leader><leader>', '<C-^>')

-- Development Accessors
if is_windows then
    vim.keymap.set('n', '<leader>dev', ':e C:/dev<CR>')
    vim.keymap.set('n', '<leader>env', ':e C:/Environment<CR>')
end

-- alt+j and alt+k for line-nudges in normal and visual mode
vim.keymap.set('n', '<A-j>', ':m .+1<CR>==', { silent = true })
vim.keymap.set('n', '<A-k>', ':m .-2<CR>==', { silent = true })
vim.keymap.set('v', '<A-j>', ":m '>+1<CR>gv=gv", { silent = true })
vim.keymap.set('v', '<A-k>', ":m '<-2<CR>gv=gv", { silent = true })

-- ===== LSPs and related setup =====
-- Custom Filetypes
vim.filetype.add({
    extension = {
        jai = 'jai',
    },
})

-- Enabled LSPs
vim.lsp.enable('lua_ls')
vim.lsp.enable('jails')

-- Diagnostics popup
vim.o.updatetime = 0
vim.api.nvim_create_autocmd("CursorHold", {
    callback = function()
        vim.diagnostic.open_float(nil, { focusable = false })
    end,
})

-- ===== Plugins =====
vim.pack.add({
  "https://github.com/folke/lazydev.nvim",            -- lazydev
  "https://github.com/nvim-lua/plenary.nvim",         -- plenary (telescope dependency)
  "https://github.com/nvim-telescope/telescope.nvim", -- telescope
})

-- Adds nvim api and functions to Lua LSP
require("lazydev").setup()

-- Autocomplete Settings
vim.opt.autocomplete = true
vim.opt.completeopt = { 'menuone', 'noinsert', 'noselect', 'popup' }
-- LLM-generated function that makes autocomplete pop up automatically
-- in the correct files.
-- TODO::LOW Learn how this works
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
            jai = true,
            -- add more as you like
        }

        if not enabled_ft[vim.bo[ev.buf].filetype] then return end

        vim.lsp.completion.enable(true, ev.data.client_id, ev.buf, {
            autotrigger = true,
        })
    end,
})

-- ===== Custom Commands ====
-- User commands must start in Uppercase and have no underscores
-- Generally follow the rule of UpperCamelCase

if is_windows then
    vim.api.nvim_create_user_command('EnvNotes',    'edit $MS_PORTABLE_ENVIRONMENT_ROOT/env_notes.txt', { desc = 'Open Environment notes.txt.' })
    vim.api.nvim_create_user_command('EnvEnv',      'edit $MS_PORTABLE_ENVIRONMENT_ROOT/env.bat',       { desc = 'Open Environment env.bat.' })
    vim.api.nvim_create_user_command('EnvLauncher', 'edit $MS_PORTABLE_ENVIRONMENT_ROOT/launcher.bat',  { desc = 'Open Environment launcher.bat.' })
end

-- ===== Whitespace Mechanics Configuration
vim.opt.tabstop = 4                                          -- Displayed size of tabs (in columns)
vim.opt.shiftwidth = 4                                       -- Number of spaces considered for indentation in any indentation task
vim.opt.expandtab = true                                     -- Insert spaces instead of a literal tab

-- ===== Editor Visuals =====
-- Whitespace visualization
vim.opt.list = true                                          -- Enables visualization mappings
vim.opt.listchars = { tab = '→ ', trail = '·', space = '·' } -- Denotes mappings for character visualization

-- Leading Column Config
vim.opt.number = true                                        -- Add numbers at front of lines
vim.opt.relativenumber = false                               -- Are line numbers relative to current position?
vim.opt.signcolumn = 'yes'                                   -- Permanently enables the leftmost column used for indications from LSPs (like Errors and Warnings)

-- No line wrap
vim.opt.wrap = false                                         -- Controls line wrapping

vim.opt.scrolloff = 8                                        -- Rows to pad on scrolling
vim.opt.sidescrolloff = 8                                    -- Columns to pad on scrolling

vim.opt.virtualedit = 'block'

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

vim.opt.colorcolumn = '80,120'                                -- Add line markers at 80 and 120 characters
vim.api.nvim_set_hl(0, 'ColorColumn', { bg = '#1e1e1e' })     -- Sets the color of the line markers

-- ===== Providers =====
vim.g.loaded_python3_provider = 0
-- vim.g.python3_host_prog
vim.g.loaded_ruby_provider = 0
-- vim.g.ruby_host_prog
vim.g.loaded_perl_provider = 0
-- vim.g.perl_host_prog
vim.g.loaded_node_provider = 0
-- vim.g.node_host_prog
