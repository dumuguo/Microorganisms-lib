const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.join(__dirname, '../database/microorganisms.db'), (err) => {
    if (err) {
        console.error('数据库连接错误:', err);
    } else {
        console.log('成功连接到数据库');
    }
});

// 创建图片存储目录
const imageDir = path.join(__dirname, '../database/images');
if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
}

// 配置multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, imageDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('只允许上传图片文件（jpeg, jpg, png, gif）'));
    }
});

// 图片上传路由
router.post('/upload/image', upload.single('imageFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '请选择要上传的图片' });
        }

        const microbeId = req.body.microbeId;
        if (!microbeId || isNaN(microbeId) || microbeId < 1) {
            return res.status(400).json({ success: false, message: '请输入有效的ID号' });
        }

        const imageUrl = `http://localhost:3002/images/${req.file.filename}`;
        
        // 更新数据库
        const sql = `UPDATE microorganisms SET image_url = ? WHERE id = ?`;
        db.run(sql, [imageUrl, microbeId], function(err) {
            if (err) {
                console.error('数据库更新错误:', err);
                return res.status(500).json({ 
                    success: false,
                    message: '数据库更新失败'
                });
            }

            if (this.changes === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: '未找到对应的微生物记录'
                });
            }

            res.json({ 
                success: true,
                imageUrl: imageUrl,
                message: '图片上传成功并已更新数据库'
            });
        });
    } catch (error) {
        console.error('图片上传错误:', error);
        res.status(500).json({ 
            success: false,
            message: error.message || '图片上传失败'
        });
    }
});

// 图片访问路由
router.get('/images/:filename', (req, res) => {
    const filePath = path.join(imageDir, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('图片未找到');
    }
});

module.exports = router;
