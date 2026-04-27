local M = {}

local failures = {}

-- Helper to safely load modules
function M.checked_require(module_name)
    local ok, module_or_err = pcall(require, module_name)
    if not ok then
        table.insert(failures, string.format('Failed to load module: %s: %s', module_name, tostring(module_or_err)))
        return nil
    end

    return module_or_err
end

function M.get_failure_report()
    return table.concat(failures, '\n')
end

function M.has_failures()
    return #failures > 0
end

return M
