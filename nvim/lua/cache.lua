local _ = require('utils')

local M = {}

local Cache = {}

function Cache:set_ref(val)
    self._current_value = val
    self._is_set = true

    if self.config.history_enabled then
        if #self._cache_history >= self.config.max_history then
            table.remove(self._cache_history, 1)
        end
        table.insert(self._cache_history, {
            value = _.deepcopy_or_nil(val),
            time = os.date()
        })
    end
end

function Cache:set(val)
    local val_copy = _.deepcopy_or_nil(val)
    self:set_ref(val_copy)
end

function Cache:get_ref()
    return self._current_value
end

function Cache:get()
    return _.deepcopy_or_nil(self:get_ref())
end

function Cache:get_history_ref()
    return self._cache_history
end

function Cache:get_history()
    return _.deepcopy_or_nil(self:get_history_ref())
end

function Cache:reset()
    self._current_value = nil
    self._cache_history = {}
    self._is_set = false
end

function Cache:is_set()
    return self._is_set
end

function M.new(opts)
    local instance = {
        _current_value = nil,
        _cache_history = {},
        _is_set = false,
        config = {
            history_enabled = true,
            max_history = 25
        }
    }
    instance.config = vim.tbl_extend('force', instance.config, opts or {})
    if instance.config.max_history <= 0 then
        instance.config.history_enabled = false
    end
    return setmetatable(instance, { __index = Cache })
end

return M
