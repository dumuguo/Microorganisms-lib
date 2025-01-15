const express = require('express');
const path = require('path');
const xlsx = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Recaptcha = require('express-recaptcha').RecaptchaV2;
const upload = multer({ dest: 'uploads/' });

const app = express();
const port = 3002;

// reCAPTCHA 配置
const recaptcha = new Recaptcha('6LfZ9rYqAAAAAKNgVv4u8CbtJUbfT5_F1CdoT8-u', '6LfZ9rYqAAAAAHE0aex_t9AgK25-XDCgD0JVg3zY');

// 确保body解析中间件最先加载
app.use((req, res, next) => {
  console.log('收到请求:', req.method, req.url);
  console.log('请求头:', req.headers);
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 验证body解析中间件
app.use((req, res, next) => {
  console.log('解析后的请求体:', req.body);
  next();
});

// Session store
const SQLiteStore = require('connect-sqlite3')(session);

// Session configuration
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: __dirname + '/database',
    concurrentDB: true
  }),
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
}));

// User database connection
const userDb = new sqlite3.Database('database/users.db');

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    req.session.user = { username: 'anonymous', role: 'guest' };
  }
  next();
};

// Admin authorization middleware
const requireAdmin = (req, res, next) => {
  if (req.session.user.role !== 'admin') {
    return res.status(403).send('无权访问');
  }
  next();
};

// Apply authentication middleware to all routes
app.use(requireAuth);

// 设置模板引擎
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 数据库初始化
const db = new sqlite3.Database('microorganisms.db', (err) => {
  if (err) {
    console.error('数据库连接失败:', err.message);
  } else {
    console.log('成功连接到SQLite数据库');
    initializeDatabase();
  }
});

// 初始化数据库表
function initializeDatabase() {
  db.run(`CREATE TABLE IF NOT EXISTS microorganisms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imau_id TEXT,
    original_id TEXT,
    latin_name TEXT,
    chinese_name TEXT,
    isolation_location TEXT,
    isolation_source TEXT,
    isolation_year INTEGER,
    medium_code TEXT,
    culture_temperature TEXT,
    genbank_id TEXT,
    preservation_form TEXT,
    storage_location TEXT,
    backup_count TEXT
  )`);
}

// User routes
app.get('/login', (req, res) => {
  res.redirect('/?error=' + (req.query.error || ''));
});

app.post('/login', (req, res) => {
  console.log('请求体:', req.body);
  const { username, password } = req.body;
  
  if (!username || !password) {
    console.log('登录失败：用户名或密码为空');
    console.log('收到的用户名:', username);
    console.log('收到的密码:', password);
    return res.redirect('/?error=1');
  }

  userDb.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      console.error('数据库查询错误:', err);
      return res.redirect('/?error=2');
    }
    
    if (!user) {
      console.log('登录失败：用户不存在');
      return res.redirect('/?error=3');
    }

    // Decode base64 password hash before comparison
    const decodedHash = Buffer.from(user.password, 'base64').toString('utf8');
    if (!bcrypt.compareSync(password, decodedHash)) {
      console.log('登录失败：密码不匹配');
      return res.redirect('/?error=4');
    }
    
    req.session.user = { username: user.username, role: user.role };
    console.log('登录成功：', user.username);
    res.redirect('/');
  });
});

// 注册页面
app.get('/register', (req, res) => {
  res.render('register', {
    captcha: recaptcha.render(),
    error: req.query.error
  });
});

// 注册处理
app.post('/register', (req, res) => {
  const { username, password, confirm_password } = req.body;
  
  // 验证密码是否匹配
  if (password !== confirm_password) {
    return res.redirect('/register?error=4');
  }

  // 验证 reCAPTCHA
  recaptcha.verify(req, (error, data) => {
    if (error) {
      return res.redirect('/register?error=5');
    }

    // 检查用户名和密码
    if (!username || !password) {
      return res.redirect('/register?error=1');
    }

    userDb.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
      if (user) {
        return res.redirect('/register?error=2');
      }
      
      // Encode password hash in base64 before storing
      const hashedPassword = Buffer.from(bcrypt.hashSync(password, 8)).toString('base64');
      const createdAt = new Date().toISOString();
      const defaultRole = 'guest';
      userDb.run('INSERT INTO users (username, password, created_at, role) VALUES (?, ?, ?, ?)', 
        [username, hashedPassword, createdAt, defaultRole], (err) => {
          if (err) {
            return res.redirect('/register?error=3');
          }
          req.session.user = { username, role: defaultRole };
          res.redirect('/');
        });
    });
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// 首页路由
app.get('/', (req, res) => {
  res.render('home', { 
    user: req.session.user,
    error: req.query.error,
    currentPage: 'home'
  });
});

// 数据上传路由
app.get('/upload', (req, res) => {
  res.render('upload', {
    currentPage: 'upload',
    user: req.session.user || { role: 'guest' }
  });
});

// 处理文件上传
app.post('/upload', upload.single('excelFile'), (req, res) => {
  // 检查用户是否登录
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: '请先登录' });
  }

  // 检查用户角色
  const userRole = req.session.user.role;
  
  // 只有user和admin角色可以上传
  if (!['user', 'admin'].includes(userRole)) {
    return res.status(403).json({ success: false, message: '上传失败：guest用户没有上传权限' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: '请选择要上传的文件' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);

    db.serialize(() => {
      const stmt = db.prepare(`
        INSERT INTO microorganisms (
          imau_id, original_id, latin_name, chinese_name,
          isolation_location, isolation_source, isolation_year,
          medium_code, culture_temperature, genbank_id,
          preservation_form, storage_location, backup_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      data.forEach(row => {
        stmt.run(
          row['IMAU编号'] || '',
          row['原始编号'] || '',
          row['拉丁文种属名'] || '',
          row['中文种属名'] || '',
          row['分离地'] || '',
          row['分离源'] || '',
          row['分离时间'] || 0,
          row['培养基代码'] || '',
          row['培养温度'] || '',
          row['GenBank序列号：'] || '',
          row['菌株保藏形式'] || '',
          row['存放位置'] || '',
          row['保藏备份数'] || ''
        );
      });

      stmt.finalize();
      res.json({ success: true, message: '上传成功' });
    });
  } catch (err) {
    console.error('文件处理错误:', err);
    res.status(500).json({ success: false, message: '文件处理失败' });
  }
});

// 搜索路由
app.get('/search', (req, res) => {
  const keyword = req.query.keyword || '';
  res.locals.currentPage = 'search';
  
  if (keyword) {
      db.all(
      `SELECT * FROM microorganisms 
       WHERE imau_id LIKE ? OR original_id LIKE ? OR latin_name LIKE ? 
       OR chinese_name LIKE ? OR isolation_location LIKE ? 
       OR isolation_source LIKE ? OR genbank_id LIKE ?`,
      [
        `%${keyword}%`, `%${keyword}%`, `%${keyword}%`,
        `%${keyword}%`, `%${keyword}%`, `%${keyword}%`,
        `%${keyword}%`
      ],
      (err, rows) => {
        if (err) {
          console.error('搜索错误:', err);
          return res.status(500).send('搜索失败');
        }
        res.render('search', { 
          results: rows,
          user: req.session.user || { role: 'guest' }
        });
      }
    );
  } else {
    res.render('search', { 
      results: null,
      user: req.session.user || { role: 'guest' }
    });
  }
});

// 浏览路由
app.get('/browse', (req, res) => {
  const start = parseInt(req.query.start) || 1;
  const end = parseInt(req.query.end) || 10;
  res.locals.currentPage = 'browse';

  db.all(
    `SELECT * FROM microorganisms 
     WHERE id BETWEEN ? AND ? 
     ORDER BY id ASC`,
    [start, end],
    (err, rows) => {
      if (err) {
        console.error('查询错误:', err);
        return res.status(500).send('查询失败');
      }
      res.render('browse', { 
        results: rows,
        start: start,
        end: end,
        user: req.session.user || { role: 'guest' }
      });
    }
  );
});

// 用户管理路由
app.get('/user-management', requireAdmin, (req, res) => {
  userDb.all('SELECT * FROM users ORDER BY id ASC', (err, users) => {
    if (err) {
      console.error('获取用户列表失败:', err);
      return res.status(500).send('获取用户列表失败');
    }
    res.render('user_management', {
      users: users,
      currentPage: 'user-management',
      user: req.session.user
    });
  });
});

// 更新用户角色路由
app.put('/users/:id/role', requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const { role } = req.body;

  // 验证角色
  if (!['guest', 'user', 'admin'].includes(role)) {
    return res.status(400).json({ success: false, message: '无效的角色' });
  }

  // 防止修改当前登录用户的角色
  if (req.session.user.id === userId) {
    return res.status(403).json({ success: false, message: '不能修改当前登录用户的角色' });
  }

    // Create promise-based versions of SQLite operations
    const runQuery = (query, params) => {
      return new Promise((resolve, reject) => {
        userDb.run(query, params, function(err) {
          if (err) return reject(err);
          resolve(this);
        });
      });
    };

    const getQuery = (query, params) => {
      return new Promise((resolve, reject) => {
        userDb.get(query, params, (err, row) => {
          if (err) return reject(err);
          resolve(row);
        });
      });
    };

    try {
      // Start transaction
      await runQuery('BEGIN TRANSACTION');
      
      // Update user role with retry logic
      const updateRole = async (attempt = 1) => {
        try {
          console.log(`尝试更新用户 ${userId} 角色为 ${role} (尝试 ${attempt})`);
          const updateResult = await runQuery(
            'UPDATE users SET role = ? WHERE id = ?', 
            [role, userId]
          );
          
          if (updateResult.changes === 0) {
            await runQuery('ROLLBACK');
            return res.status(404).json({ success: false, message: '用户不存在' });
          }

          // Verify update
          const updatedUser = await getQuery(
            'SELECT role FROM users WHERE id = ?', 
            [userId]
          );

          if (!updatedUser || updatedUser.role !== role) {
            throw new Error('角色更新验证失败');
          }

          return updatedUser;
        } catch (err) {
          if (err.code === 'SQLITE_BUSY' && attempt < maxRetries) {
            const delay = Math.min(1000, retryDelay * Math.pow(2, attempt - 1));
            console.log(`数据库锁定，重试 ${attempt}，等待 ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return updateRole(attempt + 1);
          }
          throw err;
        }
      };

      const updatedUser = await updateRole();
      if (!updatedUser) {
        await runQuery('ROLLBACK');
        return res.status(500).json({ success: false, message: '角色更新失败' });
      }

      if (updatedUser.role === role) {
        // Clear sessions
        const sessionStore = req.sessionStore;
        const maxRetries = 5;
        const retryDelay = 500;

        const clearSessions = async (attempt = 1) => {
          try {
            console.log(`开始清除用户 ${userId} 的session (尝试 ${attempt})`);
            
            // Get all sessions using the correct method
            const sessions = await new Promise((resolve, reject) => {
              sessionStore.length((err, count) => {
                if (err) {
                  if (err.code === 'SQLITE_BUSY' && attempt < maxRetries) {
                    const delay = Math.min(1000, retryDelay * Math.pow(2, attempt - 1));
                    console.log(`数据库锁定，重试 ${attempt}，等待 ${delay}ms`);
                    setTimeout(() => clearSessions(attempt + 1), delay);
                    return;
                  }
                  return reject(err);
                }
                
                // Get all sessions sequentially
                const getSessions = async () => {
                  const sessions = [];
                  for (let i = 0; i < count; i++) {
                    const session = await new Promise((resolve, reject) => {
                      sessionStore.get(i, (err, session) => {
                        if (err) return reject(err);
                        resolve(session);
                      });
                    });
                    if (session) sessions.push(session);
                  }
                  return sessions;
                };
                
                getSessions()
                  .then(resolve)
                  .catch(reject);
              });
            });

            // Filter and destroy sessions for this user
            for (const session of sessions) {
              if (session.user && session.user.id === userId) {
                await new Promise((resolve, reject) => {
                  sessionStore.destroy(session.id, (err) => {
                    if (err) {
                      if (err.code === 'SQLITE_BUSY' && attempt < maxRetries) {
                        const delay = Math.min(1000, retryDelay * Math.pow(2, attempt - 1));
                        console.log(`数据库锁定，重试 ${attempt}，等待 ${delay}ms`);
                        setTimeout(() => clearSessions(attempt + 1), delay);
                        return;
                      }
                      return reject(err);
                    }
                    resolve();
                  });
                });
              }
            }

            console.log(`成功清除用户 ${userId} 的session`);
          } catch (err) {
            console.error('清除session失败:', err);
            throw err;
          }
        };

        await clearSessions();
        await runQuery('COMMIT');
        console.log(`成功更新用户 ${userId} 角色为 ${role}`);
        res.json({ 
          success: true,
          message: `角色已成功更新为${role}`
        });
      } else {
        await runQuery('ROLLBACK');
        res.status(500).json({
          success: false,
          message: '角色更新失败，请重试'
        });
      }
    } catch (err) {
      await runQuery('ROLLBACK');
      console.error('角色更新过程中发生错误:', err);
      res.status(500).json({
        success: false,
        message: '服务器内部错误'
      });
    }
});

// 删除用户路由
app.delete('/users/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;
  
  // 防止删除当前登录用户
  if (req.session.user.id === userId) {
    return res.status(403).json({ success: false, message: '不能删除当前登录用户' });
  }

  userDb.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
    if (err) {
      console.error('删除用户失败:', err);
      return res.status(500).json({ success: false, message: '删除用户失败' });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    res.json({ success: true });
  });
});

// 启动服务器
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
