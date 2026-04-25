local M = {}

-- This works because of short-circuit evaluation
-- If val is nil or false, the expression stops evaluating
-- and returns nil.
function M.deepcopy_or_nil(val)
    return val and vim.deepcopy(val)
end

function M.concat_or_nil(...)
    if not M.is_all_primitive_concatable(...) then
        vim.notify("[utils.lua::concat_or_nil] One or more args are not primitively concatable.", vim.log.levels.WARN)
        return nil
    end
    return table.concat({...})
end

function M.concat_applicable(...)
    local args = {...}
    local running_string = ''
    for i = 1, #args do
        if M.is_primitive_concatable(args[i]) then
            running_string = running_string .. args[i]
        end
    end
    return running_string
end

function M.is_primitive_concatable(val)
    return type(val) == 'string' or type(val) == 'number'
end

function M.is_all_primitive_concatable(...)
    local args = {...}
    for i = 1, #args do
        if not M.is_primitive_concatable(args[i]) then
            return false
        end
    end
    return true
end

function M.is_all_strings(...)
    local args = {...}
    for i = 1, #args do
        if type (args[i]) ~= "string" then
            return false
        end
    end
    return true
end

function M.create_directories(directory_path)
    if not M.is_string(directory_path) then
        return false
    end
    return vim.fn.mkdir(directory_path, 'p')
end

function M.is_string(var)
    return type(var) == 'string'
end

local is_windows = vim.uv.os_uname().sysname == 'Windows_NT'
function M.is_windows()
    return is_windows
end

local is_linux = vim.uv.os_uname().sysname == 'Linux'
function M.is_linux()
    return is_linux
end

function M.pick_by_os(windows, linux)
    if M.is_windows() then
        return windows
    else
        return linux
    end
end

return M
