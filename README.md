# hideshadow.com 静态首页快照

这是从现有 Halo 首页生成的临时静态站，只保留首页展示，用于直接挂载到 Nginx。服务器运行时不需要 Java、数据库或 Node.js。

## 交付目录

将 `dist` 目录中的全部内容上传到服务器，例如：

```text
/var/www/hideshadow/
├── index.html
├── themes/
├── upload/
└── ...
```

然后将 `nginx/hideshadow.conf` 放入 Nginx 配置目录。若上传位置不同，请修改配置中的 `root`。配置已沿用原站证书路径：

```text
/etc/nginx/ssl/hideshadow_cert.pem
/etc/nginx/ssl/hideshadow_key.pem
```

`http://hideshadow.com`、`http://www.hideshadow.com` 和 `https://hideshadow.com` 都会跳转到 `https://www.hideshadow.com`。

```bash
nginx -t
systemctl reload nginx
```

配置会让不存在的文章、分类和标签地址统一显示首页，以避免备案期间出现 404。

## 重新抓取首页

仅在需要刷新快照时安装 Node.js 18 或更高版本，然后在本项目目录执行：

```bash
npm run snapshot
npm run verify
```

本地预览：

```bash
npm run preview
```

打开 `http://127.0.0.1:4173`。访问任意不存在的路径也会回退到首页。
