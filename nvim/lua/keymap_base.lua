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
end

function M.setup()
    keymap_wiping()
    keymaps()
end

return M
