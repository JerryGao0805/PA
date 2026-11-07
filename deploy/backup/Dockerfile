# 数据库备份：和数据库同一个大版本的 pg_dump，加上上传 S3 用的 aws-cli
FROM postgres:17-alpine
RUN apk add --no-cache aws-cli
COPY backup.sh /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
