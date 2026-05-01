local M = {}

function M.list()
  local marks = {}
  for i = 0, 9 do
    local mark = string.char(string.byte('A') + i)
    local info = vim.fn.getpos("'" .. mark)
    local lnum = info[2]
    local file = vim.fn.bufname(info[1])
    if lnum ~= 0 then
      table.insert(marks, { mark = mark, lnum = lnum, file = file, index = i })
    end
  end

  vim.ui.select(marks, {
    prompt = 'Bookmarks',
    format_item = function(item)
      return string.format('[%d] %s — line %d', item.index, item.file, item.lnum)
    end,
  }, function(choice)
    if choice then
      vim.cmd("normal! '" .. choice.mark)
    end
  end)
end

function M.setup()
    local set_marks = '!@#$%^&*()'  -- shift+numerbers
    local go_marks  = '1234567890'  -- numbers

    for i = 0, 9 do
        local mark = string.char(string.byte('A') + i)
        local set_key = string.sub(set_marks, i + 1, i + 1)
        local go_key  = string.sub(go_marks,  i + 1, i + 1)

        vim.keymap.set('n', '<leader>' .. set_key, function()
            vim.cmd('normal! m' .. mark)
            vim.notify('Set Bookmark ' .. go_key)
        end, { desc = 'Set mark ' .. mark })

        vim.keymap.set('n', '<leader>' .. go_key, function()
            local mark_pos = vim.api.nvim_get_mark(mark, {})
            if mark_pos[1] == 0 and mark_pos[2] == 0 then
                vim.notify('Mark ' .. go_key .. ' is not set', vim.log.levels.WARN)
                return
            end

            vim.cmd("normal! '" .. mark)
            vim.notify('Go to Bookmark ' .. go_key)
        end, { desc = 'Go to mark ' .. go_key })
    end

    vim.keymap.set('n', '<leader>b', M.list)
end

return M
