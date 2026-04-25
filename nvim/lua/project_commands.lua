local M = {}

local _ = require('utils')
local lsp_helpers = require('lsp')

local PROJECT_SCRIPT_LOCATION = _.pick_by_os('/nvim/', '/nvim/')
local EXTENSION_TYPE = _.pick_by_os('.bat', '.sh')

local function try_get_script_directory()
    local maybe_project_root = lsp_helpers.try_get_project_root()

    local maybe_script_directory = _.concat_or_nil(maybe_project_root, PROJECT_SCRIPT_LOCATION)
    if maybe_script_directory and vim.fn.isdirectory(maybe_script_directory) then
        return maybe_script_directory
    end
    return nil
end

local function try_get_script_path(script_name)
    local maybe_script_directory = try_get_script_directory()
    if not maybe_script_directory then
        vim.notify("[project_commands.lua::try_get_script_path] Unable to determine project script directory from LSP.", vim.log.levels.ERROR)
        return nil
    end

    local maybe_project_script = _.concat_applicable(maybe_script_directory, script_name, EXTENSION_TYPE)
    if vim.fn.filereadable(maybe_project_script) == 0 then
        vim.notify('[project_commands.lua::try_get_script_path] Script ' .. maybe_project_script .. ' not found.', vim.log.levels.ERROR)
        return { script = nil, script_dir = maybe_script_directory }
    end

    return { script = maybe_project_script, script_dir = maybe_script_directory }
end

function M.edit_project_script(script_name)
    local maybe_script = try_get_script_path(script_name)
    if maybe_script == nil then
        return false
    end

    if maybe_script.script_dir == nil then
        return false
    end

    vim.cmd('edit ' .. maybe_script.script_dir .. script_name .. EXTENSION_TYPE)
end


function M.run_project_script(script_name)
    local maybe_script = try_get_script_path(script_name)
    if maybe_script == nil or maybe_script.script == nil then
        return false
    end

    vim.notify(maybe_script.script)
    vim.notify(maybe_script.script_dir)

    local output = vim.system({ maybe_script.script }, { cwd = maybe_script.script_dir, text = true }):wait()
    vim.notify(output.stdout)

    return vim.v.shell_error == 0
end

return M
