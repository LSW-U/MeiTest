# MeiMart 部署指南（Staging + Production）

> 本指南覆盖 W7 D5-D6 部署任务，包括域名 + SSL + 服务器配置 + UAT 走查。

---

## 一、域名 + SSL 证书

### 1.1 域名注册

**推荐域名**：
- `meimart.com`（首选）
- `meimart.store`（备选）

**注册步骤**：
1. 在域名服务商（Namecheap / GoDaddy / Cloudflare）购买域名
2. 配置 DNS 解析：
   - A Record: `@` → 服务器 IP（印尼雅加达）
   - A Record: `api` → API 服务器 IP
   - CNAME: `admin` → `meimart.com`

### 1.2 SSL 证书

**方案 A：Let's Encrypt（免费）**
```bash
# 在服务器上安装 certbot
sudo apt install certbot python3-certbot-nginx

# 自动配置 SSL
sudo certbot --nginx -d meimart.com -d api.meimart.com

# 自动续期（90 天）
sudo certbot renew --dry-run
```

**方案 B：购买证书（商业）**
- 在 SSL 提供商购买证书（如 Comodo / DigiCert）
- 配置 Nginx/Apache 使用证书

---

## 二、服务器部署（AWS ap-southeast-3）

### 2.1 AWS EC2 配置

**推荐配置**：
- Region: `ap-southeast-3`（雅加达）
- Instance: `t3.medium`（2 vCPU, 4GB RAM）
- OS: Ubuntu 22.04 LTS
- Storage: 50GB SSD

**创建步骤**：
1. 登录 AWS Console → EC2 → Launch Instance
2. 选择 Ubuntu 22.04
3. 选择 t3.medium
4. 配置 Security Group：
   - SSH (22): 仅允许你的 IP
   - HTTP (80): All
   - HTTPS (443): All
   - Custom (3000): API 内部端口（可选关闭）
5. 创建 Key Pair 并下载 `.pem` 文件

### 2.2 SSH 配置

```bash
# 本地配置
chmod 400 meimart-staging.pem
ssh -i meimart-staging.pem ubuntu@<EC2-IP>

# 服务器配置
sudo apt update
sudo apt install -y docker.io docker-compose git nodejs npm
sudo usermod -aG docker ubuntu

# 克隆代码
git clone https://github.com/LSW-U/MeiTest.git /opt/meimart
cd /opt/meimart
```

### 2.3 Docker Compose 部署

```bash
# 启动服务
cd /opt/meimart
docker compose up -d

# 初始化数据库
pnpm install
pnpm --filter @meimart/api exec prisma migrate deploy
pnpm --filter @meimart/api db:seed
```

### 2.4 环境变量配置

**GitHub Secrets（生产环境）**：
```
STAGING_HOST=<EC2-IP>
STAGING_SSH_KEY=<私钥内容>
STAGING_USER=ubuntu
SENTRY_DSN=<Sentry DSN>
DATABASE_URL=<PostgreSQL URL>
REDIS_URL=<Redis URL>
```

**服务器 .env 文件**：
```bash
# /opt/meimart/apps/api/.env
NODE_ENV=production
DATABASE_URL=postgresql://postgres:password@localhost:5432/meimart
REDIS_URL=redis://localhost:6379
SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_TRACES_SAMPLE_RATE=1.0
```

---

## 三、CI/CD 自动部署

### 3.1 GitHub Actions Workflow

**deploy.yml 已配置**（自动触发）：
- Push to main → 自动部署 staging
- Health check → 失败告警

**手动触发**：
- GitHub Actions → Deploy Staging → Run workflow

---

## 四、UAT 走查清单

**位置**：
```
/Users/linsuwei/DevAll/Obsidian/Work-Wiki/Work-Wiki/_inbox/04-后端记录/审阅记录/MeiMart-UAT走查清单-20260701.md
```

**测试范围**（280 行）：
- 客户端 App：40 项
- 骑手 App：40 项
- Admin Web：40 项
- 异常路径：20 项

**执行步骤**：
1. 按照 UAT 清单逐项测试
2. 标记 Pass/Fail
3. 统计 bug 数量
4. 修复 bug 后重新测试

---

## 五、监控 + 告警

### 5.1 Sentry 接入

**配置**：
```bash
# 创建 Sentry 项目：https://sentry.io
# 获取 DSN
# 设置环境变量 SENTRY_DSN

# 验证 Sentry
curl http://staging-host:3000/health
# 查看 Sentry Dashboard 是否收到事件
```

### 5.2 pg_dump 定时备份

**Cron Job**：
```bash
# 编辑 crontab
crontab -e

# 添加定时任务（每天 2:00 AM）
0 2 * * * /opt/meimart/scripts/pg-backup.sh >> /var/log/meimart-backup.log 2>&1
```

**Restore 樔练**：
```bash
# 每周执行一次 restore 樔练
/opt/meimart/scripts/pg-restore-test.sh
```

---

## 六、上线 Checklist

**上线前必查**：
- ✅ 域名 DNS 解析正确
- ✅ SSL 证书生效
- ✅ Sentry 接收事件
- ✅ 备份脚本定时运行
- ✅ Restore 樔练成功
- ✅ UAT 走查全过
- ✅ 法律文档上线（隐私政策 + 用户协议 + 退款政策）
- ✅ 法律主体决策有结论

---

**部署完成后通知**：
- 团队（linsuwei）确认上线
- 用户可开始使用 MVP