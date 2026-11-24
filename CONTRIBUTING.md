# 贡献指南

1. 在 `frontend/PDFFiles/<课程>/` 添加往年题，在 `frontend/Handout/<课程>/` 添加讲义资料。
2. 文件名应包含课程、学年及考试类型。回忆版请标明，避免包含姓名、学号、联系方式等个人信息。
3. 提交前确认你有权公开分享该资料，并在 Pull Request 中说明来源、年份、内容及必要的作者署名。
4. 超过 100 MiB 的文件单独通过 Releases 分发；不要把整站压缩包或服务器备份提交到仓库。
5. 资料齐全并已放回对应目录时，可运行 `python tools/scan_files.py --root frontend` 更新索引。索引不完整的副本不要直接重建索引，以免丢失现站条目。
6. 提交前运行 `python tools/check_public.py`。不提交 `.env`、`backend/data/`、日志、密钥或证书。

现有网页的下载仍由原服务器提供。GitHub 的资料下载与原网站下载统计相互独立。
