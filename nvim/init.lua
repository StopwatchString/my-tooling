-- Core Config

vim.g.mapleader = ' '
vim.g.maplocalleader = ' '
vim.o.timeoutlen = 2000

-- Inplace restart, kept at beginning of config so it always works
vim.keymap.set('n', '<leader>R', function()
    local session = vim.fn.stdpath('state') .. '/restart_session.vim'
    vim.cmd('mksession! ' .. vim.fn.fnameescape(session))
    vim.cmd('restart source ' .. vim.fn.fnameescape(session))
end, { desc = 'Restart Neovim' })

-- Minimal 'safety' helpers, should always be safe to load
local safety = require('safety')

-- Utils
local utils = require('utils')

-- Keymap base
local keymap_base = safety.checked_require('keymap_base')
if keymap_base then
    keymap_base.setup()
end

-- LSP
local lsp_helpers = safety.checked_require('lsp')
if lsp_helpers then
    lsp_helpers.setup()
end

-- Portable Environment
local portable_environment = safety.checked_require('portable_environment')
if portable_environment then
    portable_environment.setup()
end

-- Bookmarks
local bookmarks = safety.checked_require('bookmarks')
if bookmarks then
    bookmarks.setup()
end

-- ===== Plugins =====
vim.pack.add({
    'https://github.com/folke/lazydev.nvim',            -- lazydev
    'https://github.com/cbochs/portal.nvim',            -- portals
})

-- Lazydev adds nvim api and functions to Lua LSP
local lazydev = safety.checked_require('lazydev')
if lazydev then
    lazydev.setup()
end

-- fff
local fff_search = require('fff_search')
if fff_search then
    fff_search.setup()
end

vim.keymap.set("n", "<leader>o", "<cmd>Portal jumplist backward<cr>")
vim.keymap.set("n", "<leader>i", "<cmd>Portal jumplist forward<cr>")

if safety.has_failures() then
    vim.notify(safety.get_failure_report(), vim.log.levels.ERROR)
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

-- ===== Providers =====
vim.g.loaded_python3_provider = 0
-- vim.g.python3_host_prog
vim.g.loaded_ruby_provider = 0
-- vim.g.ruby_host_prog
vim.g.loaded_perl_provider = 0
-- vim.g.perl_host_prog
vim.g.loaded_node_provider = 0
-- vim.g.node_host_prog

-- Opens fileexplorer in the current location
vim.keymap.set('n', '<leader>fv', function()
    utils.pick_by_os({
        windows = function()
            local dir = vim.fn.expand('%:p:h'):gsub('/', '\\')
            vim.fn.jobstart('explorer ' .. dir, { detach = true })
        end
    })
end, { desc = 'Open explorer here' })

-- Sets the commentstring for jai files
vim.api.nvim_create_autocmd('FileType', {
    pattern = 'jai',
    callback = function()
        vim.bo.commentstring = '// %s'
    end,
})

-- Executes before a buffer write and creates directories to reach the current
-- file path if they don't exist
vim.api.nvim_create_autocmd("BufWritePre", {
  group = vim.api.nvim_create_augroup("auto_create_dir", { clear = true }),
  callback = function(event)
    if event.match:match("^%w%w+:[\\/][\\/]") then
      return -- skip URLs like scp://, http://
    end
    local file = vim.uv.fs_realpath(event.match) or event.match
    vim.fn.mkdir(vim.fn.fnamemodify(file, ":p:h"), "p")
  end,
})

-- Command to execute before a buffer write occurs
-- Sets trim_whitespace for jai files
-- Should not set for all filetypes, as some can depend on trailing whitespace
vim.api.nvim_create_autocmd('BufWritePre', {
    pattern = '*.jai',
    callback = utils.trim_whitespace_in_current_buffer
})

-- TODO Common format command hotkey for linters
-- TODO Visualize yank (in kickstart.nvim)
-- TODO Relative line numbers alongside absolute
-- TODO Make line length markers' color derived from background color
-- TODO Investigate color themes
