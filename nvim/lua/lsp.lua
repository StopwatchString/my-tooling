--@class lsp
local M = {}

--========== HELPERS ==========

--@return string|nil
function M.project_root_or_nil()
    local clients = vim.lsp.get_clients({ bufnr = 0 })
    if #clients == 0 then
        return nil
    end
    return clients[1].config.root_dir
end

--========== Config Setup ==========

local function configure_lua()
    vim.lsp.enable('lua_ls')
end

local function configure_jai()
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

    vim.lsp.enable('jails')
end

local function configure_universal()
    -- Diagnostics popup
    vim.o.updatetime = 0
    vim.api.nvim_create_autocmd("CursorHold", {
        callback = function()
            vim.diagnostic.open_float(nil, { focusable = false })
        end,
    })

    -- Autocomplete Settings
    vim.opt.completeopt = { 'menuone', 'noselect', 'fuzzy', 'nosort' }

    vim.api.nvim_create_autocmd('LspAttach', {
        callback = function(ev)
            local client = vim.lsp.get_client_by_id(ev.data.client_id)
            if not client then return end

            local enabled_ft = {
                lua = true, python = true, rust = true, go = true,
                typescript = true, javascript = true, c = true, cpp = true, jai = true,
            }
            if not enabled_ft[vim.bo[ev.buf].filetype] then return end

            vim.lsp.completion.enable(true, ev.data.client_id, ev.buf, {
                autotrigger = true,
            })

            -- Buffer-local LSP keymaps
            local opts = { buffer = ev.buf }
            vim.keymap.set('n', 'gd', vim.lsp.buf.definition, opts)
            vim.keymap.set('n', 'gD', vim.lsp.buf.declaration, opts)
            vim.keymap.set('n', 'gi', vim.lsp.buf.implementation, opts)
            vim.keymap.set('n', 'gr', vim.lsp.buf.references, opts)
            vim.keymap.set('n', 'gy', vim.lsp.buf.type_definition, opts)
            vim.keymap.set('n', 'K', vim.lsp.buf.hover, opts)
            vim.keymap.set('n', '<C-k>', vim.lsp.buf.signature_help, opts)
            vim.keymap.set('n', '<leader>ca', vim.lsp.buf.code_action, opts)
            vim.keymap.set('n', '<leader>rn', vim.lsp.buf.rename, opts)
        end,
    })

    -- Diagnostic keymaps can stay global since diagnostics work without LSP
    vim.keymap.set('n', ']d', function()
        vim.diagnostic.jump({ count = 1, float = true })
    end)
    vim.keymap.set('n', '[d', function()
        vim.diagnostic.jump({ count = -1, float = true })
    end)
    vim.keymap.set('n', ']e', function()
        vim.diagnostic.jump({ count = 1, severity = vim.diagnostic.severity.ERROR })
    end)
    vim.keymap.set('n', '[e', function()
        vim.diagnostic.jump({ count = -1, severity = vim.diagnostic.severity.ERROR })
    end)
end

function M.setup()
    configure_lua()
    configure_jai()

    configure_universal()
end

return M
