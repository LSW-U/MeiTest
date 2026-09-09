# geo / geocode 核实记录（公共common模块 · 批1）

> 核实基线：2026-09-09 @ `main 8b319f7`；跨仓参照 mei-mart-app（client-app，只读）
> 决策依据：方案 v2 C2（保持 Nominatim）、C10（**双轨只文档化，不统一不迁移**）、C5（不加缓存/重试加固）
> ⚠️ 本文档是现状记录，不是改造方案。双轨差异如实记录，任何"统一到哪边"的动作都不在本模块范围。

---

## 一、双轨现状（C10 🔴，两套接入并存且行为不同）

### 轨道 1：后端代理端点 —— **零消费方（standby）**

- 端点：`GET /api/v1/common/geo/geocode?address=xxx`，`@Public()`，入参 zod `GeocodeRequest = { address: min2 / max500 }`（`packages/api-contract/src/schemas/geo.ts:21-23`）
- 实现：`apps/api/src/modules/common/geo/geo.service.ts` + `geo.controller.ts`
- 行为：Nominatim `/search?format=json&limit=1`，5s 超时；失败/无结果/坐标非法/长度不合法 → fallback 帝力中心（-8.5567, 125.5595），返回 `source: 'nominatim' | 'fallback'`
- 限流：controller 层内存 RateLimiter，每 IP 1 req/s + 10 req/min（超限 429 `E-COMMON-004`；W7-fix P1-3，对齐 Nominatim Usage Policy ≤1 req/s；单实例够用，多实例需切 Redis store）
- UA：`MeiMart/0.3 (dev; contact: admin@meimart.dev)` + `Accept-Language: en`
- 不缓存（地址输入多样命中率低，策略注释明确 `geo.service.ts:13`）；日志不记地址明文 PII，只记 `addressLen` + 来源（`geo.service.ts:16-17`）
- **消费方核实（全仓 grep，2026-09-09）**：admin-web 零调用；rider-app 零调用（仅 api-types 生成物含 path）；client-app **不调此端点**。→ 当前无任何运行时调用，纯 standby。

### 轨道 2：client 前端直调 —— **实际在用**

- 文件：mei-mart-app `apps/client-app/src/services/geocode.ts`
- 消费点：`apps/client-app/app/address/map.tsx`（唯一消费方：`searchPlaces` / `reverseGeocode` / `fetchNearbyPlaces`，map.tsx:30-35 import、:76/:90/:129 调用）
- 行为：
  - Nominatim `/search?format=jsonv2&limit=5&viewbox=123.9,-10.6,127.5,-7.9&bounded=1` —— **TL viewbox 地域限定**，避免同名地点干扰
  - Nominatim `/reverse`（坐标 → 地址文本，zoom=17）
  - **Overpass** `overpass-api.de`（nearby POI：坐标 2km 内带名称节点，按 Haversine 距离取前 5）
  - UA：`MeiMart-client/1.0 (delivery address picker)`（注释自述 Web fetch 不允许自定义 UA，靠 Origin 识别）
- 失败处理：直接 throw，由地图页自有逻辑兜底（无 fallback 坐标返回值语义）

### 行为差异表（方案 v2 §2.3 原表，批1 复核一致）

| 维度 | 后端 `/common/geo/geocode` | client `services/geocode.ts` 直调 |
|---|---|---|
| 源 | Nominatim `/search` | Nominatim `/search` + `/reverse` + **Overpass**（nearby POI） |
| 地域限定 | 无 bounding box | **TL viewbox 限定**（123.9,-10.6,127.5,-7.9，bounded=1） |
| 降级 | fallback 帝力中心坐标（source='fallback'） | throw，地图页自有处理 |
| UA | MeiMart/0.3 | MeiMart-client/1.0 |
| 限流 | 每 IP 1 req/s + 10 req/min（内存） | 无（依赖客户端行为自觉） |
| 现状 | **零调用（standby）** | **实际在用**（地址选择地图页） |

> ⚠️ 过时注释提醒：client `services/geocode.ts:2` 头注写"后端 geocode 代理端点未建（方案 B1）"——**该端点其实已建**（W7 P0-3），注释过时。批1 只文档化不修（改跨仓前端代码超出本批范围），供后续接手者知悉。

---

## 二、Nominatim 依赖与合规（G1）

| 项 | 现状 |
|---|---|
| 服务源 | OSM Nominatim 公共 API（`nominatim.openstreetmap.org`），免费无 key（C2：保持，无换源证据） |
| 附属依赖 | Overpass API（`overpass-api.de`，仅 client 直调轨的 nearby POI 用） |
| UA 政策 | Nominatim 要求可识别 UA：后端 `MeiMart/0.3 (dev; contact: admin@meimart.dev)`；client `MeiMart-client/1.0`（真机环境实际靠 Origin） |
| Accept-Language | 后端固定 `en`；client 未传（Nominatim 默认） |
| 速率政策 | Nominatim ≤1 req/s：后端由内存限流兑现；client 直调无显式限流（风险见 §五） |
| 超时 | 后端 5s（AbortController）；client 无显式超时 |
| 缓存 | 双轨均不缓存 |
| 日志 | 后端不记地址明文（PII），只记 addressLen + 来源；client 为端侧请求不经后端日志 |

**合规/可用性共同风险**：两条轨道同源（Nominatim），公共 API 无 SLA，弱网/被限频时同险。后端有 fallback 保业务不中断；client 直调失败由地图选点/DILI 默认坐标兜底，不阻塞下单。

---

## 三、下单 → 仓库匹配链路（G2）

```
[client 地址录入]
  ├─ 地图选点（app/address/map.tsx：searchPlaces 选点 / reverseGeocode 回填 / fetchNearbyPlaces POI）
  ├─ 未选地图 → 默认帝力坐标 DILI_LAT=-8.5569, DILI_LNG=125.5603（address.ts:38-40，:55-56 应用）
  └─ 旧地址补坐标 → PATCH /addresses/:id 支持 lat/lng（address.ts:99 附近）
        ↓
[存地址带 lat/lng] （后端要求地址有 lat/lng 用于匹配仓库——address.ts:38 注释）
        ↓
[下单匹配仓库]
  ├─ shared/db/postgis-helpers.ts:31 findWarehouseByPoint(lng,lat)
  │    ST_Within（coverageArea 覆盖判定）+ ST_Distance（最近优先）→ 最近 ACTIVE 仓库
  │    无覆盖 → 业务层抛 E-ORDER-OUT-OF-DELIVERY-RANGE（postgis-helpers.ts:29 注释）
  └─ modules/inventory/inventory.service.ts:52 matchWarehouse(lat,lng)：包装上述 helper，
       返回 warehouseId/code/name/deliveryFee/distance；getStockByAddress 切地址重查库存
```

**失败/弱网降级行为**：
- geocode 失败（后端轨）：返回 fallback 帝力中心坐标，`source:'fallback'`，地址仍可保存——地理编码是辅助信息，不阻塞；
- geocode 失败（client 轨）：地图页 throw 自兜底，用户仍可用默认坐标/手动方式完成地址；
- 仓库匹配失败：抛 `E-ORDER-OUT-OF-DELIVERY-RANGE`，下单被拒（这是业务边界，非降级）。

---

## 四、G3 帝力实测记录（2026-09-09，开发机）

### 4.0 对照基线：开发机网络到 Nominatim **不可达**（先记录，区分"开发机网络"与"帝力网络"）

| 测试 | 命令（摘要） | 原始结果 |
|---|---|---|
| 直连 Nominatim 连通性 | `curl -m 8 -A "MeiMart/0.3 (dev; contact: admin@meimart.dev)" "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=Dili"` | `curl: (28) Connection timed out after 8006 milliseconds`，HTTP:000，耗时 8.0s |
| DNS 解析 | `nslookup nominatim.openstreetmap.org` | 正常解析 `168.143.171.189`（DNS 通，TCP 连不上） |
| 同域主站对照 | `curl -m 6 https://www.openstreetmap.org` | HTTP:000 超时 |
| 一般外网对照 | `curl -m 6 https://www.baidu.com` | HTTP:200（0.16s，网络本身可用） |
| Overpass 对照 | `curl -m 6 https://overpass-api.de/api/status` | HTTP:200（0.75s，**Overpass 可达，Nominatim 单独不可达**） |

结论：开发机（中国大陆网络环境）到 `nominatim.openstreetmap.org` **TCP 不可达**（DNS 正常、非整机断网、Overpass 同期可达）。与方案 v2 §2.3 前置发现一致（v2 同日实测同样结论）。

### 4.1 seed 地址（C7，`apps/api/prisma/seed.ts`）

| # | 地址 | 来源行 |
|---|---|---|
| 1 | `Rua dos Martires da Patria, Dili` | seed.ts:53（W01 仓库） |
| 2 | `Avenida bispo medeiros, Dili, Timor-Leste` | seed.ts:165（shop） |
| 3 | `Rua dos Martires da Patria, No. 12` | seed.ts:528（Alice Home 收货地址） |
| 4 | `Avenida Bispo de Medeiros, Edificio 3` | seed.ts:541（Office 收货地址） |

（seed.ts:63 `Avenida Baucau, Baucau` / :73 `Rua Principal, Maliana` 非帝力，按 C7 不选。）

### 4.2 三链路实测结果（全部命中"开发机不可达"预期）

**① 直连 Nominatim**（后端同参数）：

```
=== 直连: Rua dos Martires da Patria, Dili ===
curl: (28) Connection timed out after 8004 milliseconds
=== 直连: Avenida bispo medeiros, Dili, Timor-Leste ===
curl: (28) Connection timed out after 8006 milliseconds
```

**② 后端 geocode 端点**（本地 dev server `localhost:3000`，4 地址全测）：

```
=== 后端 geocode: Rua dos Martires da Patria, Dili ===
{"success":true,"data":{"lat":-8.5567,"lng":125.5595,"formattedAddress":null,"source":"fallback"}}
HTTP:200 5.003947s
=== 后端 geocode: Avenida bispo medeiros, Dili, Timor-Leste ===
{"success":true,"data":{"lat":-8.5567,"lng":125.5595,"formattedAddress":null,"source":"fallback"}}
HTTP:200 5.003208s
=== 后端 geocode: Rua dos Martires da Patria, No. 12 ===
{"success":true,"data":{"lat":-8.5567,"lng":125.5595,"formattedAddress":null,"source":"fallback"}}
HTTP:200 5.002400s
=== 后端 geocode: Avenida Bispo de Medeiros, Edificio 3 ===
{"success":true,"data":{"lat":-8.5567,"lng":125.5595,"formattedAddress":null,"source":"fallback"}}
HTTP:200 5.003257s
```

观察：4/4 fallback；每次耗时 ≈5.0s（恰好是 5s 超时阈值）——证明超时→fallback 链路按设计工作，且 **fallback 语义保证了业务不中断**（HTTP 200 + 合法坐标返回）。但这也意味着后端轨每请求白等 5s，弱网真机上若 Nominatim 同样不可达，用户保存地址会各多等 5s（单请求内）。

**③ client 直调链路**（模拟其参数：format=jsonv2 + viewbox + bounded=1）：

```
=== client 直调(模拟 UA/viewbox): Rua dos Martires da Patria, Dili ===
curl: (28) Connection timed out after 8005 milliseconds
=== client 直调(模拟 UA/viewbox): Avenida bispo medeiros, Dili, Timor-Leste ===
curl: (28) Connection timed out after 8006 milliseconds
```

（真机上 client 是 RN fetch，参数一致，网络路径同为 Nominatim 域名——开发机结论可外推：同一网络下 client 轨同样不可达。）

### 4.3 命中率结论与真机挂账

- 开发机命中率：直连 0/2、后端轨 0/4（全 fallback）、client 轨 0/2——**均为网络不可达所致，不代表 Nominatim 对帝力地址的真实命中率**；
- 帝力真实命中率：**待真机弱网验证（挂账）**，需在帝力网络环境重跑 §4.2 三链路，与本节开发机基线对比定性；
- 附带发现（不改现状，按 C2/C5 记录）：后端轨在不可达时每请求固定消耗 5s 超时窗，若未来切真实消费方，可评估更短超时；client 轨无显式超时，真机弱网体验待验证。

---

## 五、风险登记（对齐方案 v2 §5）

| 风险 | 定性 | 处置 |
|---|---|---|
| 开发机到 Nominatim 不可达（本机网络） | 已实证 | 开发联调依赖 geocode 的场景走 fallback；不影响其它外网依赖 |
| 帝力弱网可达性未知 | 挂账 | 真机弱网验证（与地图瓦片同源风险），对照 §4.0 基线 |
| client 直调无显式限流/超时 | 现状记录 | C10 不统一；若后续切换到后端代理轨则自动获得限流+fallback（不在本批做） |
| client `services/geocode.ts` 头注过时（"后端端点未建"） | 文档级 | 已在 §一 标注，跨仓修注释不属本批 |
