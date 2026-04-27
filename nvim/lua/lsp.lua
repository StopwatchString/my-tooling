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

    -- Keymaps
    vim.keymap.set("n", "gd", vim.lsp.buf.definition)
end

function M.setup()
    configure_lua()
    configure_jai()

    configure_universal()
end

return M
