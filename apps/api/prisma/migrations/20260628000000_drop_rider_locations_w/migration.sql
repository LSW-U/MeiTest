-- W4.5 P0-2: 删 rider_locations + rider_location_histories 死表
-- 原因：WS location:update handler 没写库，这两个表永远是空的
-- 在线骑手状态改用 Redis rider:online:{riderId} SETEX（rider.service heartbeat 维护）
-- 历史轨迹推 W5/W6 真做配送追踪时再加回来

DROP TABLE IF EXISTS "rider_location_histories" CASCADE;
DROP TABLE IF EXISTS "rider_locations" CASCADE;
