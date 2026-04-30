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

    vim.keymap.set('n', '<leader>b', M.list)
end

return M
