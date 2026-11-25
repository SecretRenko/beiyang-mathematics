# 北洋数院集萃

天津大学数学课程讲义、往年题与学习资料，以及资源下载站源码。

- 网站：https://beiyangmathmatics.site/
- GitHub：https://github.com/SecretRenko/beiyang-mathematics
- 友情链接：[天津大学课程共享计划](https://cs.tjuse.com/zh-CN/)、[天津大学数学学院本科生指北](https://jiyouhai.github.io/tju-math-guide/professional_courses/)

## 目录

| 路径 | 内容 |
| --- | --- |
| `frontend/` | 网站页面、样式和资源索引 |
| `frontend/PDFFiles/` | 课程往年题及相关资料 |
| `frontend/Handout/` | 讲义和学习资料 |
| `backend/` | 下载统计与签名接口源码，不含生产数据 |
| `tools/` | 资源索引生成及发布前检查工具 |
| `resource-manifest.json` | 文件大小、SHA-256、缺失文件及 Releases 清单 |

## 本地预览

在仓库根目录运行 `python -m http.server 8080 --directory frontend`，访问 http://127.0.0.1:8080/ 。

页面可浏览和搜索；生产环境下载依赖 Nginx 签名下载路由。本地静态预览不模拟生产下载服务。

需要预览 API 时，复制 `backend/.env.example` 为 `backend/.env`，另开终端运行 `node backend/server.js`。API 的统计、额度及密钥保存在本地 `backend/data/`，不提交到仓库。

## 资料维护

见 [贡献指南](CONTRIBUTING.md)。网站索引保持现有 152 条，不因本地缺失文件而静默删除条目。

本地已找到其中 151 份；`PDFFiles/高等代数A/25级高等代数(A)期末考试.pdf` 尚待从现站或维护者处补齐。`Handout/拓扑学/大类.zip` 超过 GitHub 普通仓库的单文件限制，计划作为 Releases 附件单独发布，不能直接提交。

这是网站源码和资料的整理版本，不是完整生产环境备份。部署配置需按实际服务器编写；不包含服务器凭据、访问日志、下载统计、证书和历史备份。

## 使用与来源

资料保留原作者权利和原有声明。公开收录不代表获得任意转载或重新许可的权利；本仓库不对第三方资料统一追加开源许可证。仅供学习交流，请勿用于商业用途。如有错误、署名或版权问题，请通过 Issue 或网站联系方式反馈。

## 上传状态

代码、资料及清单已在本地整理，尚未成功推送到 GitHub；仓库写入请求被当前连接权限拒绝。以仓库实际文件和资源清单核对备份完整性。
