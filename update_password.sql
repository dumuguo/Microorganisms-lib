-- 更新所有用户的密码哈希值为base64编码格式
UPDATE users 
SET password = (
  SELECT printf('%.*s', 
    CAST((LENGTH(password) * 4 + 2) / 3 AS INTEGER),
    REPLACE(REPLACE(REPLACE(
      CAST(
        (LENGTH(password) / 3 * 4) + 
        CASE WHEN LENGTH(password) % 3 > 0 THEN 4 ELSE 0 END
      AS TEXT),
      'A', '='), 'B', '+'), 'C', '/')
  )
  FROM users AS u 
  WHERE u.rowid = users.rowid
);
