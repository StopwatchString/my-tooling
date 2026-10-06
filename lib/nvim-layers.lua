-- lib/nvim-layers.lua — loads every layer's nvim/ directory.
--
-- Called from the managed block at the top of ~/.config/nvim/init.lua (which
-- the host owns) with the layers' nvim/ dirs, lowest precedence first:
--   1. puts them on the runtimepath right after the config dir, highest layer
--      first, so a later layer's lua/ module hides an earlier one's (setup.sh
--      warns about that) and the host's ~/.config/nvim/lua/ hides them all;
--   2. puts their after/ dirs before the config dir's after/, lowest first;
--   3. runs each layer's init.lua in order. A failing one is reported and the
--      rest still load.
-- The host's own init.lua lines after the block run last and win.

return function(dirs)
    local present = {}
    for _, dir in ipairs(dirs) do
        if vim.uv.fs_stat(dir) then
            table.insert(present, dir)
        end
    end

    local config = vim.fn.stdpath('config')
    local config_after = config .. '/after'
    local rtp = {}
    local placed, placed_after = false, false
    for _, path in ipairs(vim.opt.runtimepath:get()) do
        if path == config_after and not placed_after then
            for _, dir in ipairs(present) do
                table.insert(rtp, dir .. '/after')
            end
            placed_after = true
        end
        table.insert(rtp, path)
        if path == config and not placed then
            for i = #present, 1, -1 do
                table.insert(rtp, present[i])
            end
            placed = true
        end
    end
    if not placed then
        for i = #present, 1, -1 do
            table.insert(rtp, 1, present[i])
        end
    end
    if not placed_after then
        for _, dir in ipairs(present) do
            table.insert(rtp, dir .. '/after')
        end
    end
    vim.opt.runtimepath = rtp

    for _, dir in ipairs(present) do
        local init = dir .. '/init.lua'
        if vim.uv.fs_stat(init) then
            local ok, err = pcall(dofile, init)
            if not ok then
                vim.notify('dotfiles: ' .. init .. ' failed: ' .. tostring(err), vim.log.levels.ERROR)
            end
        end
    end
end
