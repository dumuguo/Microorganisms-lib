const express = require('express');
const path = require('path');
const xlsx = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const upload = multer({ dest: 'uploads/' });
const imageRoutes = require('./routes/images');

const app = express();
const port = 3002;

// 确保body解析中间件最先加载
app.use((req, res, next) => {
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 验证body解析中间件
app.use((req, res, next) => {
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
// 图片上传路由
app.use(imageRoutes);
// 图片静态文件服务
app.use('/images', express.static(path.join(__dirname, 'database/images')));

// 数据库初始化
const db = new sqlite3.Database('database/microorganisms.db', (err) => {
  if (err) {
    return;
  } else {
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
    backup_count TEXT,
    image_url TEXT,
    upload_user TEXT,
    upload_time TEXT
  )`);
}

// User routes
app.get('/login', (req, res) => {
  res.redirect('/?error=' + (req.query.error || ''));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.redirect('/?error=1');
  }

  userDb.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.redirect('/?error=2');
    }
    
    if (!user) {
      return res.redirect('/?error=3');
    }

    // Decode base64 password hash before comparison
    const decodedHash = Buffer.from(user.password, 'base64').toString('utf8');
    if (!bcrypt.compareSync(password, decodedHash)) {
      return res.redirect('/?error=4');
    }
    
    req.session.user = { username: user.username, role: user.role };
    res.redirect('/');
  });
});

// 注册页面
app.get('/register', (req, res) => {
  res.render('register', {
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
    
    // 添加调试信息

      db.serialize(() => {
        // Get current row count to determine starting ID
        db.get('SELECT COUNT(*) as count FROM microorganisms', (err, result) => {
          if (err) {
            return res.status(500).json({ success: false, message: '无法获取当前记录数' });
          }
          
          const startId = result.count + 1;
          let currentId = startId;
          
          const stmt = db.prepare(`
            INSERT INTO microorganisms (
              id, imau_id, original_id, latin_name, chinese_name,
              isolation_location, isolation_source, isolation_year,
              medium_code, culture_temperature, genbank_id,
              preservation_form, storage_location, backup_count,
              image_url, upload_user, upload_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          
          data.forEach(row => {
            // Remove any existing upload_user and upload_time from Excel data
            delete row['上传用户'];
            delete row['上传时间'];
            
            stmt.run(
              currentId++,
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
              row['保藏备份数'] || '',
              row['图片链接'] || '',
              req.session.user.username, // Always use logged-in user
              new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() // Use Beijing time (UTC+8)
            );
          });

          stmt.finalize();
          res.json({ 
            success: true, 
            message: `上传成功，共上传了${data.length}条记录（一行代表一条记录）`,
            count: data.length 
          });
        });
      });
  } catch (err) {
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
       OR isolation_source LIKE ? OR CAST(isolation_year AS TEXT) LIKE ?
       OR medium_code LIKE ? OR culture_temperature LIKE ?
       OR genbank_id LIKE ? OR preservation_form LIKE ?
       OR storage_location LIKE ? OR backup_count LIKE ?
       OR image_url LIKE ? OR upload_user LIKE ? 
       OR strftime('%Y-%m-%d %H:%M:%S', upload_time) LIKE ?
       OR strftime('%Y', upload_time) LIKE ?`,
      [
        `%${keyword}%`, `%${keyword}%`, `%${keyword}%`,
        `%${keyword}%`, `%${keyword}%`, `%${keyword}%`,
        `%${keyword}%`, `%${keyword}%`, `%${keyword}%`,
        `%${keyword}%`, `%${keyword}%`, `%${keyword}%`,
        `%${keyword}%`, `%${keyword}%`, `%${keyword}%`,
        `%${keyword}%`
      ],
      (err, rows) => {
        if (err) {
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
  const start = parseInt(req.query.start);
  const end = parseInt(req.query.end);
  res.locals.currentPage = 'browse';

  // 如果提供了记录号范围
  if (start && end) {
    // 验证范围
    if (start < 1 || end < 1 || start > end) {
      return res.status(400).send('无效的记录号范围');
    }

    db.all(
      `SELECT * FROM microorganisms 
       WHERE id BETWEEN ? AND ?
       ORDER BY id ASC`,
      [start, end],
      (err, rows) => {
        if (err) {
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
  } else {
    // 默认分页浏览
    const page = parseInt(req.query.page) || 1;
    const perPage = 10;
    const offset = (page - 1) * perPage;

    // Get total count
    db.get('SELECT COUNT(*) as total FROM microorganisms', (err, countResult) => {
      if (err) {
        return res.status(500).send('查询失败');
      }

      // Get current page data
      db.all(
        `SELECT * FROM microorganisms 
         ORDER BY id ASC
         LIMIT ? OFFSET ?`,
        [perPage, offset],
        (err, rows) => {
          if (err) {
            return res.status(500).send('查询失败');
          }

          const totalPages = Math.ceil(countResult.total / perPage);
          
          const start = offset + 1;
          const end = Math.min(offset + perPage, countResult.total);
          
          res.render('browse', { 
            results: rows,
            currentPage: page,
            totalPages: totalPages,
            start: start,
            end: end,
            user: req.session.user || { role: 'guest' }
          });
        }
      );
    });
  }
});

// 用户管理路由
app.get('/user-management', requireAdmin, (req, res) => {
  userDb.all('SELECT * FROM users ORDER BY id ASC', (err, users) => {
    if (err) {
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
            
            // Get all sessions using the correct method
            const sessions = await new Promise((resolve, reject) => {
              sessionStore.length((err, count) => {
                if (err) {
                  if (err.code === 'SQLITE_BUSY' && attempt < maxRetries) {
                    const delay = Math.min(1000, retryDelay * Math.pow(2, attempt - 1));
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

          } catch (err) {
            throw err;
          }
        };

        await clearSessions();
        await runQuery('COMMIT');
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
