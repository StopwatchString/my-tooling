--@class lsp_helpers
local Module = {}

--@return string|nil
function Module.try_get_project_root()
    local clients = vim.lsp.get_clients({ bufnr = 0 })
    if #clients == 0 then
        return nil
    end
    return clients[1].config.root_dir
end

return Module
