local M = {}

local _ = require('utils')
local lsp_helpers = require('lsp')

local PROJECT_SCRIPT_LOCATION = _.pick_by_os({ windows = '/nvim/', linux = '/nvim/' })
local EXTENSION_TYPE = _.pick_by_os({ windows = '.bat', linux = '.sh' })

local last_successful_project_root = nil

local function cacheable_project_root_or_nil()
    local maybe_project_root = lsp_helpers.project_root_or_nil()

    if maybe_project_root == nil then
        maybe_project_root = last_successful_project_root
    else
        last_successful_project_root = maybe_project_root
    end

    return maybe_project_root
end

local function script_directory_or_nil()
    local maybe_project_root = cacheable_project_root_or_nil()

    local maybe_script_directory = _.concat_or_nil(maybe_project_root, PROJECT_SCRIPT_LOCATION)
    if maybe_script_directory and vim.fn.isdirectory(maybe_script_directory) then
        return maybe_script_directory
    end
    return nil
end

local function script_path_or_nil(script_name)
    local script_path_info = {
        script = nil,
        script_dir = nil
    }

    local maybe_script_directory = script_directory_or_nil()
    if not maybe_script_directory then
        vim.notify("[project_commands.lua::try_get_script_path] Unable to determine project script directory from LSP.", vim.log.levels.WARN)
        return script_path_info
    end

    local maybe_project_script = _.concat_applicable(maybe_script_directory, script_name, EXTENSION_TYPE)
    if vim.fn.filereadable(maybe_project_script) == 0 then
        vim.notify('[project_commands.lua::try_get_script_path] Script ' .. maybe_project_script .. ' not found.', vim.log.levels.WARN)
        return script_path_info
    end

    return { script = maybe_project_script, script_dir = maybe_script_directory }
end

function M.edit_project_script(script_name)
    local maybe_script = script_path_or_nil(script_name)
    if maybe_script == nil then
        return false
    end

    if maybe_script.script_dir == nil then
        return false
    end

    vim.cmd('edit ' .. maybe_script.script)
end

function M.run_project_script(script_name)
    local maybe_script = script_path_or_nil(script_name)
    if maybe_script == nil or maybe_script.script == nil then
        return false
    end

    vim.notify(maybe_script.script)
    vim.notify(maybe_script.script_dir)

    local output = vim.system({ maybe_script.script }, { cwd = maybe_script.script_dir, text = true }):wait()
    vim.notify(output.stdout)

    return vim.v.shell_error == 0
end

function M.open_project_root()
    local maybe_project_root = cacheable_project_root_or_nil()

    if maybe_project_root == nil then
        return false
    end

    vim.cmd('edit ' .. maybe_project_root)
end

function M.setup()
    vim.keymap.set('n', '<F1>', function()
        M.edit_project_script('build_debug')
    end, { desc = '' })

    vim.keymap.set('n', '<F2>', function()
        M.edit_project_script('run_debug')
    end, { desc = '' })

    vim.keymap.set('n', '<F3>', function()
        M.edit_project_script('build_release')
    end, { desc = '' })

    vim.keymap.set('n', '<F4>', function()
        M.edit_project_script('run_release')
    end, { desc = '' })

    vim.keymap.set('n', '<F5>', function()
        M.run_project_script('build_debug')
    end, { desc = '' })

    vim.keymap.set('n', '<F6>', function()
        M.run_project_script('run_debug')
    end, { desc = '' })

    vim.keymap.set('n', '<F7>', function()
        M.run_project_script('build_release')
    end, { desc = '' })

    vim.keymap.set('n', '<F8>', function()
        M.run_project_script('run_release')
    end, { desc = '' })
end

return M
