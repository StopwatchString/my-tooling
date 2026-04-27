local M = {}

local _ = require('utils')

function M.setup()
    if _.is_windows() then
        vim.api.nvim_create_user_command('EnvNotes',    'edit $MS_ENVIRONMENT_CONFIG_PATH/env_notes.txt', { desc = 'Open Environment notes.txt.' })
        vim.api.nvim_create_user_command('EnvEnv',      'edit $MS_ENVIRONMENT_CONFIG_PATH/env.bat',       { desc = 'Open Environment env.bat.' })
        vim.api.nvim_create_user_command('EnvLauncher', 'edit $MS_ENVIRONMENT_CONFIG_PATH/launcher.bat',  { desc = 'Open Environment launcher.bat.' })
    end
end

return M
