local M = {}

local module_failure_string = ''

-- Helper to safely load modules
function M.checked_require(module_name)
    local module_ok, module_or_err = pcall(require, module_name)
    if not module_ok then
        module_failure_string = module_failure_string .. 'Failed to load module: ' .. module_name .. ': ' .. tostring(module_or_err) .. '\n'
        return nil
    end

    return module_or_err
end

function M.get_failure_report()
    return module_failure_string
end

return M
