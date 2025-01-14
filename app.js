const express = require('express');
const path = require('path');
const xlsx = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const upload = multer({ dest: 'uploads/' });

const app = express();
const port = 3002;

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

// Session configuration
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
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
  res.render('login', { error: req.query.error });
});

app.post('/login', (req, res) => {
  console.log('请求体:', req.body);
  const { username, password } = req.body;
  
  if (!username || !password) {
    console.log('登录失败：用户名或密码为空');
    console.log('收到的用户名:', username);
    console.log('收到的密码:', password);
    return res.redirect('/login?error=1');
  }

  userDb.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      console.error('数据库查询错误:', err);
      return res.redirect('/login?error=2');
    }
    
    if (!user) {
      console.log('登录失败：用户不存在');
      return res.redirect('/login?error=3');
    }

    // Decode base64 password hash before comparison
    const decodedHash = Buffer.from(user.password, 'base64').toString('utf8');
    if (!bcrypt.compareSync(password, decodedHash)) {
      console.log('登录失败：密码不匹配');
      return res.redirect('/login?error=4');
    }
    
    req.session.user = { username: user.username, role: user.username === 'admin' ? 'admin' : 'user' };
    console.log('登录成功：', user.username);
    res.redirect('/');
  });
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.redirect('/register?error=1');
  }

  userDb.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (user) {
      return res.redirect('/register?error=2');
    }
    
    // Encode password hash in base64 before storing
    const hashedPassword = Buffer.from(bcrypt.hashSync(password, 8)).toString('base64');
    userDb.run('INSERT INTO users (username, password) VALUES (?, ?)', 
      [username, hashedPassword], (err) => {
        if (err) {
          return res.redirect('/register?error=3');
        }
        req.session.user = { username, role: 'user' };
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
  res.render('home', { user: req.session.user });
});

// 数据上传路由
app.get('/upload', (req, res) => {
  res.render('upload');
});

// 处理文件上传
app.post('/upload', upload.single('excelFile'), (req, res) => {
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
      res.json({ success: true });
    });
  } catch (err) {
    console.error('文件处理错误:', err);
    res.status(500).json({ success: false, message: '文件处理失败' });
  }
});

// 搜索路由
app.get('/search', (req, res) => {
  const keyword = req.query.keyword || '';
  
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
        res.render('search', { results: rows });
      }
    );
  } else {
    res.render('search', { results: null });
  }
});

// 浏览路由
app.get('/browse', (req, res) => {
  const start = parseInt(req.query.start) || 1;
  const end = parseInt(req.query.end) || 10;

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
        end: end
      });
    }
  );
});

// 启动服务器
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
