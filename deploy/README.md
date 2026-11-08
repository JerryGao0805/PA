# 部署

一台 VPS 上用 Docker Compose 跑所有服务：

```
用户 ──HTTPS──▶ web（Caddy：自动申请证书，前端静态文件，/api 转给 api）
                 └─▶ api（FastAPI） ──┐
                     worker（发邮件、清理过期数据）──┼─▶ postgres
                     backup（每天 pg_dump，可选上传 S3）──┘
                     migrate（每次启动先跑数据库迁移，成功后 api、worker 才启动）
```

- 镜像由 GitHub Actions 构建（`.github/workflows/deploy.yml`）：main 上的 CI 通过后，构建 `api`、`web`、`backup` 三个镜像推到 GHCR，标签是提交的 SHA 和 `latest`
- 服务器上只需要部署目录里的三个文件：`docker-compose.prod.yml`、`caddy/Caddyfile`、`.env`
- 只有 web 对外开放 80、443 端口；数据库和 API 只在 Docker 的内部网络里

## 1. 准备

- **服务器**：1 核 2GB 内存足够，系统用 Ubuntu 24.04。按 [Docker 官方文档](https://docs.docker.com/engine/install/ubuntu/)装好 Docker Engine 和 compose 插件，把部署用的用户加进 `docker` 组。防火墙只开放 22、80、443（TCP），以及 443/UDP（HTTP/3）
- **域名**：A 记录（有 IPv6 的话再加 AAAA）指向服务器。Caddy 第一次启动时会用它申请 Let's Encrypt 证书，所以 DNS 要先生效
- **邮件**：Resend（必需，见下一节）
- **AWS**：S3 存备份（可选，不配置时备份只留在服务器上）

镜像默认构建 `linux/amd64`。服务器是 ARM 的话，把 `deploy.yml` 里的 `PLATFORMS` 改成 `linux/arm64`。

## 2. 邮件（Resend）

worker 通过 Resend 的 HTTP API 发邮件（走 443 端口，不受服务器封 SMTP 端口的影响）。

1. 注册 [Resend](https://resend.com)，Domains → Add Domain，填 `EMAIL_FROM` 里的域名。Region 用默认的 us-east-1 就行
2. 按页面列出的记录在 DNS 里添加（以页面为准），然后点 Verify，等状态变成 Verified：
   - DKIM：一条 TXT 记录，名字是 `resend._domainkey`
   - SPF（Enable Sending 下面）：`send`、`rsend` 两条 CNAME 记录（退信会发到这两个子域）
   - 页面上的值是截断显示的，要用复制按钮复制完整的值
   - DNS 在 Cloudflare 的话，可以直接点页面右上角的 Auto configure，授权后 Resend 会自动添加。手动添加时，CNAME 记录的代理状态一定要关掉（灰色云朵，DNS only），否则验证不通过
   - 下面的 Receiving（收信用的 MX 记录）不用开

   这些和网站的 A 记录、根域名用来收信的 MX 记录都不冲突；以前为 SES 加的 CNAME 也可以留着
3. DMARC：加一条 TXT 记录，名字是 `_dmarc`，值先用 `v=DMARC1; p=none; rua=mailto:你的邮箱`，观察一段时间没问题后改成 `p=quarantine`。Resend 用你的域名做 DKIM 签名，所以能通过 DMARC
4. API Keys → Create API Key：Permission 选 **Sending access**，Domain 选这个域名。这个 key 放在服务器上，就算泄露了，也只能用这个域名发信，看不到邮件记录、改不了设置。填到 `.env` 的 `RESEND_API_KEY`

免费额度是每天 100 封、每月 3000 封（以官网为准）。超出时 Resend 返回 429，worker 会按退避重试（最多 8 次，前后大约 2 小时）；用户多了再升级套餐。Resend 后台的 Emails 页面能看到每封邮件的状态（Delivered、Bounced 等）。

### 换成 AWS SES（可选）

代码也支持 SES。新账号在沙箱里，只能发给验证过的地址，要申请生产权限才能发给所有人。

1. SES 控制台 → Identities → Create identity，选 Domain，用 Easy DKIM。把给出的 3 条 CNAME 加到域名的 DNS 里，等状态变成 Verified
2. 申请生产权限（Account dashboard → Request production access）：说明是事务性邮件（注册验证、找回密码），由用户主动触发，量很小
3. 建一个只能发邮件的 IAM 用户，策略（把区域、账号、域名换成自己的）：

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "ses:SendEmail",
         "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
       }
     ]
   }
   ```

4. 在 `.env` 里设 `EMAIL_BACKEND=ses`，填 `SES_REGION`、`SES_AWS_ACCESS_KEY_ID`、`SES_AWS_SECRET_ACCESS_KEY`，然后在部署目录里运行 `docker compose -f docker-compose.prod.yml up -d`（worker 会用新的配置重建）

## 3. S3 备份（可选）

1. 新建存储桶（保持默认的「阻止所有公开访问」），打开版本控制
2. 生命周期规则：前缀 `backups/` 的对象 30 天后删除（旧版本也一起清理）
3. 建一个只能往里写的 IAM 用户。这个密钥放在服务器上，就算泄露也读不到、删不掉备份：

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:AbortMultipartUpload"],
         "Resource": "arn:aws:s3:::你的存储桶/backups/*"
       }
     ]
   }
   ```

   填到 `.env` 的 `BACKUP_S3_BUCKET`、`BACKUP_AWS_ACCESS_KEY_ID`、`BACKUP_AWS_SECRET_ACCESS_KEY`

## 4. 第一次部署

镜像要先存在：把代码合并到 main，等 Actions 里的 Deploy 跑完（没有配置服务器时它只构建、推送镜像）。

```bash
# 本地：把部署文件拷到服务器
ssh 服务器 'sudo mkdir -p /opt/personal-assistant && sudo chown $USER /opt/personal-assistant'
scp deploy/docker-compose.prod.yml deploy/.env.example 服务器:/opt/personal-assistant/
scp -r deploy/caddy 服务器:/opt/personal-assistant/

# 服务器上
cd /opt/personal-assistant
cp .env.example .env && chmod 600 .env
vi .env    # 按注释填写

# 仓库是私有的，GHCR 上的镜像也是私有的：用一个只有 read:packages 权限的
# Personal access token（classic）登录一次
echo '令牌' | docker login ghcr.io -u 你的GitHub用户名 --password-stdin

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps   # migrate 是 exited (0)，其他是 running / healthy
```

然后打开 `https://你的域名` 注册一个账号，检查：

- 收到验证邮件。没收到就看 `docker compose -f docker-compose.prod.yml logs worker`，以及 Resend 后台的 Emails 页面
- `ls backups/` 里有备份文件。注意启动时那一份是在迁移之前做的，可能是空库；之后每天一份，也可以手动做一份（见下面）

## 5. 自动部署

在 GitHub 仓库的 Settings → Secrets and variables → Actions 里配置：

| 类型 | 名字 | 值 |
|---|---|---|
| Variable | `DEPLOY_HOST` | 服务器地址 |
| Variable | `DEPLOY_USER` | 部署用的用户（要在 `docker` 组里） |
| Variable | `DEPLOY_PATH` | 部署目录，不填默认 `/opt/personal-assistant` |
| Secret | `DEPLOY_SSH_KEY` | 专门用来部署的私钥：`ssh-keygen -t ed25519 -f deploy_key -N ''`，公钥加到服务器上这个用户的 `~/.ssh/authorized_keys` |
| Secret | `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 服务器地址` 的输出（防止中间人冒充服务器） |

配置好以后，每次合并到 main 且 CI 通过：构建镜像 → 上传 `docker-compose.prod.yml` 和 `Caddyfile` → 拉取这次提交的镜像 → `up -d`（先迁移再启动）→ 重新加载 Caddy 配置。也可以在 Actions 页面手动运行 Deploy。

## 6. 日常运维

下面的命令都在部署目录里执行，可以先设一个别名：

```bash
alias dc='docker compose -f /opt/personal-assistant/docker-compose.prod.yml'
```

- **看日志**：`dc logs -f api worker`、`dc logs backup`
- **手动备份一次**（例如在手动改数据之前）：`dc run --rm backup once`
- **从备份恢复**：

  ```bash
  dc stop api worker
  dc exec -T postgres pg_restore --clean --if-exists --no-owner -U pa -d pa < backups/pa-20261105T030000Z.dump
  dc start api worker
  ```

  S3 上的备份要用有读权限的凭证下载（服务器上的备份密钥只能写），例如在自己电脑上 `aws s3 cp s3://存储桶/backups/pa-….dump .` 再传到服务器。
  建议隔一段时间演练一次：恢复到一个临时库里看数据对不对，不影响线上的库：

  ```bash
  dc exec postgres createdb -U pa restore_drill
  dc exec -T postgres pg_restore --no-owner -U pa -d restore_drill < backups/pa-….dump
  dc exec postgres psql -U pa -d restore_drill -c 'select count(*) from tasks'
  dc exec postgres dropdb -U pa restore_drill
  ```

- **回滚到之前的版本**：`IMAGE_TAG=之前那次提交的SHA dc up -d`。数据库迁移不会自动回退：如果新版本里有迁移，旧版本可能用不了新的表结构，要先 `dc run --rm api alembic downgrade 版本号`，或者从迁移之前的备份恢复
- **改了 Caddyfile**：`dc exec web caddy reload --config /etc/caddy/Caddyfile`
- **改了 `.env`**：`dc up -d`（变量变了的服务会重建）

## 安全相关的设置

- 会话 Cookie 叫 `__Host-pa_session`：浏览器强制要求 HTTPS、整个站点有效、不能被子域设置
- Caddy 加了 HSTS、CSP（脚本只能来自本站）、`X-Content-Type-Options` 等响应头，去掉了 `Server` 头
- API 信任 `X-Forwarded-For`（限流按真实 IP 算）：API 不对外暴露，只有 Caddy 能访问它，而 Caddy 会丢掉用户自己带的这个头
- `/api/docs` 在生产环境关闭
- 各服务的日志按 10MB 轮转，最多留 5 个文件
