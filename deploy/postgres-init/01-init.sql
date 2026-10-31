-- 首次初始化数据卷时执行：创建测试库，并在两个库里启用 citext
CREATE DATABASE pa_test OWNER pa;
\connect pa
CREATE EXTENSION IF NOT EXISTS citext;
\connect pa_test
CREATE EXTENSION IF NOT EXISTS citext;
