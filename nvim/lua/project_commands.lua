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

function M.run_build_script(suffix)
    local maybe_script_directory = try_get_script_directory()
    if not maybe_script_directory then
        vim.notify("[project_commands.lua::run_build_script] Unable to determine script directory.", vim.log.levels.ERROR)
        return false
    end

    local maybe_build_script = _.concat_applicable(maybe_script_directory, 'build', suffix, EXTENSION_TYPE)
    if not vim.fn.executable(maybe_build_script) then
        vim.notify("[project_commands.lua::run_build_script] Build script either does not exist or is not executable.", vim.log.levels.ERROR)
        return false
    end

    local output = vim.system({maybe_build_script}, { cwd = maybe_script_directory, text = true }):wait()
    vim.notify(output.stdout)
    return vim.v.shell_error == 0
end

return M
