local M = {}

local _ = require('utils')

local function keymap_wiping()
    vim.keymap.set('', '<F1>', '<Nop>')
end

local function keymaps()
    -- init.lua hotkey
    vim.keymap.set('n', '<leader>rc', ':e $MYVIMRC<CR>')

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

    -- alt+j and alt+k for line-nudges in normal and visual mode
    vim.keymap.set('n', '<A-j>', ':m .+1<CR>==', { silent = true })
    vim.keymap.set('n', '<A-k>', ':m .-2<CR>==', { silent = true })
    vim.keymap.set('v', '<A-j>', ":m '>+1<CR>gv=gv", { silent = true })
    vim.keymap.set('v', '<A-k>', ":m '<-2<CR>gv=gv", { silent = true })

    -- Set escape to be able to exit Terminal mode
    vim.keymap.set('t', '<Esc>', '<C-\\><C-n>', { silent = true })

    -- Window manipulation
    -- Navigate between windows: <leader> + hjkl
    vim.keymap.set('n', '<leader>h', '<C-w>h', { desc = 'Go to window left' })
    vim.keymap.set('n', '<leader>j', '<C-w>j', { desc = 'Go to window down' })
    vim.keymap.set('n', '<leader>k', '<C-w>k', { desc = 'Go to window up' })
    vim.keymap.set('n', '<leader>l', '<C-w>l', { desc = 'Go to window right' })

    -- Shift = duplicate current window in that direction (same buffer)
    vim.keymap.set('n', '<leader>H', '<cmd>leftabove vsplit<cr>',  { desc = 'Duplicate window left' })
    vim.keymap.set('n', '<leader>J', '<cmd>belowright split<cr>',  { desc = 'Duplicate window down' })
    vim.keymap.set('n', '<leader>K', '<cmd>aboveleft split<cr>',   { desc = 'Duplicate window up' })
    vim.keymap.set('n', '<leader>L', '<cmd>rightbelow vsplit<cr>', { desc = 'Duplicate window right' })

    -- Ctrl = move current window to that edge
    vim.keymap.set('n', '<leader><C-h>', '<C-w>H', { desc = 'Move window left' })
    vim.keymap.set('n', '<leader><C-j>', '<C-w>J', { desc = 'Move window down' })
    vim.keymap.set('n', '<leader><C-k>', '<C-w>K', { desc = 'Move window up' })
    vim.keymap.set('n', '<leader><C-l>', '<C-w>L', { desc = 'Move window right' })

    -- Ctrl+Shift = open terminal in that direction
    local function term_split(direction)
        return function()
            local dir = vim.fn.expand('%:p:h')
            vim.cmd(direction .. ' | lcd ' .. vim.fn.fnameescape(dir) .. ' | terminal')
        end
    end
    vim.keymap.set('n', '<leader>th', term_split('leftabove vsplit'),  { desc = 'Terminal left' })
    vim.keymap.set('n', '<leader>tj', term_split('belowright split'),  { desc = 'Terminal down' })
    vim.keymap.set('n', '<leader>tk', term_split('aboveleft split'),   { desc = 'Terminal up' })
    vim.keymap.set('n', '<leader>tl', term_split('rightbelow vsplit'), { desc = 'Terminal right' })

    -- Close window
    vim.keymap.set('n', '<leader>q', '<cmd>close<cr>', { desc = 'Close window' })

    -- Comments
    vim.keymap.set('n', '<leader>c', 'gcc', { remap = true, desc = 'Toggle comment line' })
    vim.keymap.set('x', '<leader>c', 'gc',  { remap = true, desc = 'Toggle comment selection' })
end

function M.setup()
    keymap_wiping()
    keymaps()
end

return M
