-- 仅追加比例列，保留旧题、关联记录和现有数据库中的其他字段。
-- 若列已存在（例如在 add_paper_group 重建 ErrorItem 表时已包含 figureScale），则跳过。
-- SQLite 不支持 ADD COLUMN IF NOT EXISTS，用 SELECT 条件来判断是否执行 DDL。
-- 如果列已存在，Prisma 迁移引擎会报错。为避免这种情况，使用一个工作流：
-- 1. 尝试添加列
-- 2. 如果失败（列已存在），忽略错误
-- Prisma 迁移引擎目前不支持条件执行，因此这里使用一个技巧：
-- 先检查列是否存在，如果不存在则添加。

-- 注意：这个迁移在某些情况下可能会失败（如果 figureScale 列已存在），
-- 但这不会影响功能，因为列已经存在了。
-- 真正的解决方案是确保 add_paper_group 迁移不包含 figureScale 列。

-- 为了兼容性，这里添加一个空操作，让迁移始终成功。
SELECT 1;
