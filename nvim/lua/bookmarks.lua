local M = {}

function M.setup()
    local set_marks = '!@#$%^&*()'
    local go_marks  = '1234567890'  -- unshifted versions

    for i = 0, 9 do
        local mark = string.char(string.byte('A') + i)
        local set_key = string.sub(set_marks, i + 1, i + 1)
        local go_key  = string.sub(go_marks,  i + 1, i + 1)

        vim.keymap.set('n', '<leader>' .. set_key, function()
            vim.cmd('normal! m' .. mark)
        end, { desc = 'Set mark ' .. mark })

        vim.keymap.set('n', '<leader>' .. go_key, function()
            vim.cmd("normal! '" .. mark)
        end, { desc = 'Go to mark ' .. mark })
    end
end

return M
