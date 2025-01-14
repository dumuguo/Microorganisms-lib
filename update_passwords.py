import sqlite3
import bcrypt
import base64

# 连接到用户数据库
conn = sqlite3.connect('database/users.db')
cursor = conn.cursor()

# 获取所有用户
cursor.execute("SELECT rowid, password FROM users")
users = cursor.fetchall()

# 更新每个用户的密码哈希值
for user in users:
    rowid, password = user
    # 如果密码是bcrypt格式，则进行base64编码
    if password.startswith('$2a$'):
        # 将bcrypt哈希值转换为base64编码
        encoded_password = base64.b64encode(password.encode('utf-8')).decode('utf-8')
        cursor.execute("UPDATE users SET password = ? WHERE rowid = ?", 
                      (encoded_password, rowid))

# 提交更改并关闭连接
conn.commit()
conn.close()
