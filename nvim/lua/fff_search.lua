local M = {}

local safety = require('safety')
local lsp_helpers = require('lsp')
local _ = require('utils')

local search_directory = _.pick_by_os({windows = 'C:\\dev', linux = '~/dev'})

function M.setup()
    local fff = safety.checked_require('fff')
    if not fff then
        return
    end

    vim.keymap.set('n', '<leader>ff', function() fff.find_files_in_dir(search_directory) end, { desc = 'FFF Dev folder' })
    vim.keymap.set('n', '<leader>fp', function()
        local project_root_or_nil = lsp_helpers.project_root_or_nil()
        if project_root_or_nil then
            fff.find_files_in_dir(project_root_or_nil)
        else
            vim.notify('No project root detected', vim.log.levels.WARN)
        end
    end, { desc = 'FFF Project Dir' })
end

return M
