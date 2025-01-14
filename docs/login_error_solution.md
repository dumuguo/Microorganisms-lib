# 登录错误信息显示解决方案

## 问题描述
首页登录错误信息无法正常显示

## 解决方案
1. 修改 app.js 中的首页路由：
```javascript
app.get('/', (req, res) => {
  const error = req.query.error;
  res.render('index', { error });
});
```

2. 重启服务器：
```bash
pkill -f "node app.js" && node app.js
```

3. 验证步骤：
- 使用错误用户名/密码登录
- 检查首页右侧是否显示相应错误信息
- 错误代码对应关系：
  - 3: 用户不存在
  - 4: 密码不匹配

## 注意事项
- 确保服务器正常运行
- 检查数据库连接状态
- 验证用户认证逻辑
