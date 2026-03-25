# AstraShell HTTP Sync API

当前桌面端 `http` 同步 provider 约定如下：

- 基础地址：`<baseUrl>`
- 鉴权：可选 `Authorization: Bearer <token>`
- 数据格式：`application/json`

## 1. GET `/meta`

返回远端当前快照元信息。

响应示例：

```json
{
  "ok": true,
  "exists": true,
  "fileId": "4d8503df-61ae-4a58-b2ad-3d8777866b31",
  "revision": 12,
  "signature": "10240:1742877000000:7f6c9c8c1d...",
  "storageVersion": 2,
  "updatedAt": 1742877000000,
  "size": 10240,
  "encrypted": true
}
```

字段也可以包在 `meta` 内：

```json
{
  "ok": true,
  "meta": {
    "exists": true,
    "fileId": "4d8503df-61ae-4a58-b2ad-3d8777866b31",
    "revision": 12,
    "signature": "10240:1742877000000:7f6c9c8c1d..."
  }
}
```

## 2. GET `/download`

下载完整快照。

响应示例：

```json
{
  "ok": true,
  "fileId": "4d8503df-61ae-4a58-b2ad-3d8777866b31",
  "revision": 12,
  "signature": "10240:1742877000000:7f6c9c8c1d...",
  "storageVersion": 2,
  "content": "{\n  \"app\": \"AstraShell\",\n  ...\n}"
}
```

也支持：

```json
{
  "ok": true,
  "meta": {
    "fileId": "4d8503df-61ae-4a58-b2ad-3d8777866b31",
    "revision": 12
  },
  "contentBase64": "ewogICJhcHAiOiAiQXN0cmFTaGVsbCIsCiAgLi4uCn0="
}
```

## 3. PUT `/upload`

上传本地完整快照。

请求示例：

```json
{
  "fileId": "4d8503df-61ae-4a58-b2ad-3d8777866b31",
  "revision": 12,
  "baseRevision": 11,
  "signature": "10240:1742877000000:7f6c9c8c1d...",
  "storageVersion": 2,
  "content": "{\n  \"app\": \"AstraShell\",\n  ...\n}"
}
```

成功响应示例：

```json
{
  "ok": true,
  "fileId": "4d8503df-61ae-4a58-b2ad-3d8777866b31",
  "revision": 12,
  "signature": "10240:1742877000000:7f6c9c8c1d...",
  "storageVersion": 2,
  "updatedAt": 1742877000000
}
```

冲突建议响应：

```json
{
  "ok": false,
  "error": "remote revision is newer",
  "conflict": true,
  "revision": 13
}
```

## 4. 设计说明

- 客户端当前做的是“整库快照同步”，不是增量同步。
- 客户端会在启动后后台尝试 `pull`。
- 本地改动成功写盘后，会按防抖时间自动 `push`。
- 如果远端 `revision` 高于本地且 `signature` 不同，客户端会拒绝覆盖并提示先下载。
- 当前版本更适合单人多端或低冲突团队场景。
