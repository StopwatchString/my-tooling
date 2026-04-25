-- Environment Variables

vim.g.mapleader = ' '
vim.g.maplocalleader = ' '
vim.o.timeoutlen = 2000

-- ====== Modules =====
local _ = require('utils')
local project_commands = require('project_commands')

-- ====== Keymaps =====

-- init.lua hotkey
vim.keymap.set('n', '<leader>rc', ':e $MYVIMRC<CR>')

-- Inplace restart
vim.keymap.set('n', '<leader>R', function()
    local session = vim.fn.stdpath('state') .. '/restart_session.vim'
    vim.cmd('mksession! ' .. vim.fn.fnameescape(session))
    vim.cmd('restart source ' .. vim.fn.fnameescape(session))
end, { desc = 'Restart Neovim' })

-- Quick map to open project root (only if it can be sourced from the LSP)
vim.keymap.set('n', '<leader>pr', function()
  local clients = vim.lsp.get_clients({ bufnr = 0 })
  local root = clients[1] and clients[1].config.root_dir
  if not root then
    vim.notify("No LSP root found", vim.log.levels.WARN)
    return
  end
  vim.cmd.Ex(root)
end)

-- Open directory of current file
vim.keymap.set("n", "<leader>.", function()
  vim.cmd.edit(vim.fn.expand("%:p:h"))
end, { desc = "Open directory of current file" })

-- Alternate file quick flip
vim.keymap.set('n', '<leader><leader>', '<C-^>')

-- Development Accessors
if _.is_windows() then
    vim.keymap.set('n', '<leader>dev', ':e C:/dev<CR>')
    vim.keymap.set('n', '<leader>env', ':e C:/Environment<CR>')
end

-- Project Scripts
vim.keymap.set('n', '<F1>', function()
    project_commands.edit_project_script('build_debug')
end, { desc = '' })

vim.keymap.set('n', '<F2>', function()
    project_commands.edit_project_script('run_debug')
end, { desc = '' })

vim.keymap.set('n', '<F3>', function()
    project_commands.edit_project_script('build_release')
end, { desc = '' })

vim.keymap.set('n', '<F4>', function()
    project_commands.edit_project_script('run_release')
end, { desc = '' })

vim.keymap.set('n', '<F5>', function()
    project_commands.run_project_script('build_debug')
end, { desc = '' })

vim.keymap.set('n', '<F6>', function()
    project_commands.run_project_script('run_debug')
end, { desc = '' })

vim.keymap.set('n', '<F7>', function()
    project_commands.run_project_script('build_release')
end, { desc = '' })

vim.keymap.set('n', '<F8>', function()
    project_commands.run_project_script('run_release')
end, { desc = '' })

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

-- Activate jai treesitter in .jai files
vim.api.nvim_create_autocmd('FileType', {
  pattern = 'jai',
  callback = function()
    pcall(vim.treesitter.start)
  end,
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

-- Autocomplete Settings
vim.opt.completeopt = { 'menuone', 'noselect', 'fuzzy', 'nosort' }
-- LLM-generated function that makes autocomplete pop up automatically
-- in the correct files.
vim.api.nvim_create_autocmd('LspAttach', {
    callback = function(ev)
        -- Get reference to LSP via global list id lookup from event's attached id info
        local client = vim.lsp.get_client_by_id(ev.data.client_id)
        if not client then return end

        -- Check if this list of filetypes includes the filetype of the lsp's current buffer
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
        }
        if not enabled_ft[vim.bo[ev.buf].filetype] then return end

        -- Toggle autocompletion of the LSP on, with the autotrigger option set to true
        vim.lsp.completion.enable(true, ev.data.client_id, ev.buf, {
            autotrigger = true,
        })
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

-- ===== Custom Commands ====
-- User commands must start in Uppercase and have no underscores
-- Generally follow the rule of UpperCamelCase

if _.is_windows() then
    vim.api.nvim_create_user_command('EnvNotes',    'edit $MS_ENVIRONMENT_CONFIG_PATH/env_notes.txt', { desc = 'Open Environment notes.txt.' })
    vim.api.nvim_create_user_command('EnvEnv',      'edit $MS_ENVIRONMENT_CONFIG_PATH/env.bat',       { desc = 'Open Environment env.bat.' })
    vim.api.nvim_create_user_command('EnvLauncher', 'edit $MS_ENVIRONMENT_CONFIG_PATH/launcher.bat',  { desc = 'Open Environment launcher.bat.' })
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

vim.opt.virtualedit = 'block'                                -- Allows freeform block selection in visual-block mode (ctrl-v / ctrl-q)

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

-- Enable Undofile and Undotree
vim.opt.undofile = true
vim.opt.undolevels = 10000
vim.cmd("packadd nvim.undotree")
vim.keymap.set("n", "<leader>u", function()
  require("undotree").open({ command = "botright 45vnew" })
end)

-- Disable swapfile
vim.opt.swapfile = false
vim.opt.autowriteall = true

vim.opt.colorcolumn = '80,120'                                -- Add line markers at 80 and 120 characters
vim.api.nvim_set_hl(0, 'ColorColumn', { bg = '#1e1e1e' })     -- Sets the color of the line markers

vim.keymap.set('t', '<Esc>', '<C-\\><C-n>', { silent = true })

-- ===== Providers =====
vim.g.loaded_python3_provider = 0
-- vim.g.python3_host_prog
vim.g.loaded_ruby_provider = 0
-- vim.g.ruby_host_prog
vim.g.loaded_perl_provider = 0
-- vim.g.perl_host_prog
vim.g.loaded_node_provider = 0
-- vim.g.node_host_prog


-- ===== Scratch Area =====
-- TODO Solve blocks comments command per-filetype
-- TODO Terminal keymap?
-- TODO Native whitespace trim
-- TODO Common format command hotkey for linters
-- TODO Format on save/whitespace trim on save
-- TODO Build and Run hotkeys that use LSP workspace?
-- TODO Build and Run hotkeys schema that are powered by special naming convention for build scripts, just for me
-- TODO Visualize yank (in kickstart.nvim)
-- TODO Relative line numbers alongside absolute
-- TODO Telescope keymaps
-- TODO Make line length markers' color derived from background color
-- TODO Investigate color themes (and how to change them)
-- TODO mini.nvim features
-- TODO vendor plugins?


vim.keymap.set("n", "gd", vim.lsp.buf.definition)
