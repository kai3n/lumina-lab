# 得月 / De Lune 供应商移动订单工作台

## 产品与架构边界

这是一个独立构建、只面向手机的白标 Vendor Web App。界面默认中文“得月”、英文/韩文“De Lune”，可用环境变量随时替换；页面不显示 BeloveD 或 Diamond D。它可以使用独立域名，但继续复用主项目的 Express/PostgreSQL 后端。

产品身份模型按当前决定实现为“一个 Vendor = 一个登录账号”，没有 Vendor 组织与成员两层。管理员创建 Vendor、生成一次性邀请链接并分配订单；Vendor 设置密码后使用独立 Cookie 登录。后端始终从 session 获取 `supplier_id`，不接受前端指定 vendorId。

Vendor 只看到被分配订单的生产字段。客户姓名、邮箱、电话、地址、零售价、付款记录、内部利润和管理备注不会进入 Vendor API 响应。

## 技术栈

- 手机端：React 19、Vite 7、三语 i18n。
- API：现有 Express 4 服务，新增 `/v1/vendor` 与 `/v1/admin/suppliers`。
- 数据库：现有 PostgreSQL；迁移 `0016_supplier_portal.sql`、`0017_supplier_password_reset.sql`、`0018_supplier_media_assets.sql`、`0019_supplier_customer_qc_review.sql`。
- 上传：现有 AWS S3 SDK 签发短期 PUT URL，支持腾讯云 COS 和原有 Cloudflare R2。

## 腾讯云 COS

中国 Vendor 上传建议使用广州地域 COS。后端已支持 COS 的 S3 兼容 Endpoint：

```text
VENDOR_MEDIA_PROVIDER=cos
COS_REGION=ap-guangzhou
COS_BUCKET=delune-vendor-<APPID>
COS_ACCESS_KEY_ID=<SecretId>
COS_SECRET_ACCESS_KEY=<SecretKey>
COS_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com
COS_PUBLIC_URL=https://media.example.com
```

SecretId/SecretKey 只放 API 服务环境变量，不能放进 `VITE_*`。Vendor 上传 URL 有效期 30 分钟，视频最大 200MB；Vendor 文件 key 为 `vendor/<supplierId>/<jobCode>/<scope>/<date>/<random>.<ext>`。浏览器 PUT 后必须调用完成接口，API 使用 HEAD 校验对象大小与 MIME，只有状态变为 `READY` 的媒体才能提交到订单更新。

你还需要在 COS 控制台配置 CORS：Origin 填 Vendor/Admin 网页的准确域名（不要用 `*`），Method 允许 `PUT`、`GET`、`HEAD`，请求头允许 `Content-Type`、`Range`，Expose-Headers 建议包含 `ETag`、`Content-Length`、`Content-Range`。

## API 合同

| Method | Path | 用途 |
|---|---|---|
| POST | `/v1/vendor/auth/accept-invite` | 邀请 token + 新密码激活账号 |
| POST | `/v1/vendor/auth/password` | 邮箱密码登录 |
| POST | `/v1/vendor/auth/password-reset/request` | 请求一小时有效的密码重置邮件；响应不透露邮箱是否存在 |
| POST | `/v1/vendor/auth/password-reset/confirm` | 使用一次性 token 设置新密码并登录；其他已登录设备保持登录 |
| POST | `/v1/vendor/auth/logout` | 注销当前 session |
| GET | `/v1/vendor/me` | 当前 Vendor |
| GET | `/v1/vendor/orders` | 只列出当前 Vendor 的订单 |
| GET | `/v1/vendor/orders/:code` | 脱敏订单详情 |
| POST | `/v1/vendor/orders/:code/updates` | 追加 NOTE/CAD/PROGRESS/QC 等记录 |
| POST | `/v1/vendor/orders/:code/stage` | ACKNOWLEDGE 或 HANDOFF_READY |
| POST | `/v1/vendor/orders/:code/media/upload-url` | 校验订单、任务和当前状态后签发 COS PUT URL |
| POST | `/v1/vendor/orders/:code/media/:mediaCode/complete` | HEAD 校验上传结果并把媒体置为 READY |
| GET/POST | `/v1/vendor/inventory` | 当前 Vendor 裸钻库存 |
| PATCH | `/v1/vendor/inventory/:id` | 修改自己的库存 |
| GET/POST | `/v1/admin/suppliers` | 管理员查看/创建 Vendor |
| POST | `/v1/admin/suppliers/:code/invites` | 生成一次性邀请链接并尝试发送 Vendor 邀请邮件；返回复制链接兜底 |
| POST | `/v1/admin/orders/:code/supplier` | 分配订单 |

## Vendor / Admin 订单联动合同

`customer_orders` 与 `supplier_order_assignments` 表达两个不同层面的事实：前者是客户订单生命周期，后者是供应商履约生命周期。两者不互相复制状态，也不由网页自行换算；所有写操作都通过服务端的统一状态合同，在同一个数据库事务中更新。

每个供应商状态固定投影出三项运营信息：客户订单的 `stage/phase/waiting_on`、当前负责人 `owner`、下一步动作 `action`。Vendor 订单列表、Admin 订单列表和 Admin 单订单页都读取这份服务端结果。Vendor 提交需要审核的材料后，订单必须显示 `owner=OPERATIONS` 与对应的 `REVIEW_*` 动作；Admin 批准或退回后，再把负责人交给客户或 Vendor。

制作进度采用最小但完整的闭环：

```text
IN_PRODUCTION
  -> Vendor 提交 PROGRESS
PROGRESS_REVIEW（BeloveD 待审核）
  -> 批准：IN_PRODUCTION
  -> 退回：PROGRESS_CHANGES -> Vendor 重交 -> PROGRESS_REVIEW
  -> Admin 确认制作完成：QC_REQUIRED
```

CAD 和 QC 的内部批准会创建客户可见材料及客户确认任务；客户确认或要求修改后，供应商状态和客户订单投影在同一事务中一起更新。

`HANDOFF_READY` 表示供应商已准备向 BeloveD 交付，`COMPLETED` 表示 BeloveD 已确认收到供应商交付。它们都不等于客户订单 `DELIVERED`；只有客户订单完成尾款、物流和签收流程后，才进入 `DELIVERED`。这是两套状态机之间最重要的不变量。

## 数据库

迁移新增 `suppliers`、`supplier_invites`、`supplier_password_reset_tokens`、`supplier_order_assignments`、`supplier_updates`、`supplier_inventory`，并把 `supplier` 加入现有通用 session 类型。`0018` 扩展统一的 `media_assets`，记录供应商、订单分配、用途、provider、对象 key、校验状态和 ETag；`supplier_updates.media` 只接受已经验证且属于同一任务的媒体 ID。`0019` 补齐制作进度审核和客户成品确认所需的供应商状态。每一条订单分配、更新和库存都以 `supplier_id` 隔离。密码重置 token 在数据库中只保存 SHA-256 hash、使用后立即失效；其他已登录设备保持登录。

不需要在数据库控制台手工建表。只要生产环境已有正确的 `DATABASE_URL`，部署时运行：

```bash
npm run db:migrate
```

## 上线配置

1. PostgreSQL 设置 `DATABASE_URL` 并执行迁移。
2. API 设置 `PUBLIC_ORIGIN`、`VENDOR_ORIGIN`、完整的 `VENDOR_APP_URL`、邮件与 COS 环境变量。`VENDOR_ORIGIN` 只能是准确 Origin；`VENDOR_APP_URL` 可以包含 `/BeloveD/vendor/` 之类的部署路径。
3. Vendor App 设置 `VITE_DEMO_MODE=false`、`VITE_VENDOR_API_URL=<API 地址>` 和白标名称。
4. 管理员创建 Vendor、复制邀请链接给对方，再为其分配订单。
5. 先用少量真实订单灰度，核对腾讯文档中的字段后再迁移历史数据。
