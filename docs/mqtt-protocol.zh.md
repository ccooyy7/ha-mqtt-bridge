# MQTT 对接协议

本文面向设备接入平台。连接地址、端口、账号、密码由部署方另行提供；本文不包含可使用的服务器或现场设备目录。

默认使用 MQTT 3.1.1，网关发布消息使用 QoS 1。订阅方应能处理重复消息，并在断线后恢复连接与订阅。

## Topic 约定

```text
gw/{site}/entity/{entity_id}/{endpoint}
```

默认 site 为 `home`，例如 `gw/home/entity/light.example/state`。`entity_id` 是设备唯一标识。所有示例设备均为虚构，不代表已注册设备。

| endpoint | 方向 | 消息类型 | 默认 retained |
| --- | --- | --- | --- |
| meta | 网关到平台 | JSON，设备名称及通用命令 | 是 |
| state | 网关到平台 | JSON，最近状态 | 是 |
| availability | 网关到平台 | 文本 online / offline | 是 |
| set | 平台到网关 | JSON，控制请求 | 必须否 |
| ack | 网关到平台 | JSON，已接受处理 | 否 |
| result | 网关到平台 | JSON，服务调用结果 | 否 |

sensor 为只读，不提供可用的 set 控制接口。未知或不可写实体的控制请求会被拒绝。

`gw/home/entity/+/state` 订阅全部设备状态，`gw/home/entity/climate.example/#` 订阅一个设备的全部消息。通配符仅用于订阅，不用于发布。

## 状态查询与更新

订阅 state 时，若 Broker 存有 retained 消息，会发送最近一次上报。没有保留消息则等待后续发布。此过程不会强制设备重新读取状态，也不提供过去所有状态的历史。

保持订阅可接收后续变化；平台无需轮询或重复订阅。网关的定期发现可能补发相同状态，平台应按 entity_id 更新本地缓存。

示例状态：

```json
{
  "entity_id": "light.example",
  "state": "on",
  "brightness_pct": 75,
  "color_temp_kelvin": 4000,
  "friendly_name": "示例灯",
  "unit_of_measurement": null,
  "last_changed": "2026-01-01T00:00:00Z",
  "last_updated": "2026-01-01T00:00:02Z",
  "updated_at": "2026-01-01T00:00:03Z"
}
```

| 字段 | 含义 |
| --- | --- |
| entity_id | 设备唯一标识 |
| state | 主状态，类型通常是字符串；数值传感器也可能返回字符串 |
| friendly_name | 设备上报的显示名称 |
| unit_of_measurement | 单位或 null |
| last_changed | 主状态最后变化时间 |
| last_updated | 主状态或属性最后更新时间 |
| updated_at | 网关构造本次发布消息的时间，不代表设备最近采样时间 |

时间使用 ISO 8601，Z 或 +00:00 表示 UTC。所选但设备未提供的属性为 null。

| 类型 | 默认业务属性 |
| --- | --- |
| light | brightness_pct、color_temp_kelvin、friendly_name |
| climate | current_temperature、target_temperature、hvac_mode、hvac_action、fan_mode、preset_mode、friendly_name |
| cover | current_position、friendly_name |
| fan | percentage、preset_mode、friendly_name |
| switch / input_boolean / input_button / scene | friendly_name |
| sensor | friendly_name、unit_of_measurement |

brightness_pct 为 0–100% 的亮度；current_position 为窗帘位置百分比；空调 target_temperature 是目标温度，控制请求使用参数 temperature。场景、按钮的主状态不应解释为持续开关状态。

## 元数据

meta 提供 entity_id、domain、object_id、topic_base、name、writable、unit_of_measurement、device_class、state_class、supported_features、commands。只读配置的 writable 为 false，commands 为空数组。

commands 是经过网关配置限制的类型级命令，不保证设备具备所有功能。具体模式枚举、温度范围和位置控制能力，需由部署方确认；不能根据其他设备推断。

## 控制请求

发布到设备的 set Topic：

```json
{
  "request_id": "client-demo-001",
  "command": "set_fan_mode",
  "params": { "fan_mode": "high" }
}
```

request_id 和 command 为必填字符串。params 可省略，提供时必须是 JSON 对象。目标设备由 Topic 决定，params 中不能重定向 entity_id。

| 类型 | 命令 | 常用参数 |
| --- | --- | --- |
| light | turn_on / turn_off / toggle | turn_on 可用 brightness_pct 0–100、brightness 0–255、color_temp_kelvin、rgb_color、transition |
| switch / input_boolean | turn_on / turn_off / toggle | 无 |
| climate | set_temperature | temperature 或设备支持的 target_temp_low / target_temp_high |
| climate | set_hvac_mode / set_fan_mode / set_preset_mode | 分别为 hvac_mode / fan_mode / preset_mode |
| climate | turn_on / turn_off | 无 |
| cover | open_cover / close_cover / stop_cover | 无 |
| cover | set_cover_position | position 0–100 |
| fan | turn_on / turn_off / toggle | 部分设备 turn_on 支持 percentage |
| fan | set_percentage / set_preset_mode | 分别为 percentage 0–100 / preset_mode |
| input_button | press | 无 |
| scene | turn_on | 无 |
| sensor | 不支持 | 只读 |

参数以设备支持为准，不要同时发送 brightness 与 brightness_pct。当前部分必填参数、枚举和范围由下游服务校验，不接受的参数组合可能在 result 中返回错误。

## 回执与最终状态

接受处理后发 ack：

```json
{
  "request_id": "client-demo-001",
  "entity_id": "climate.example",
  "status": "accepted",
  "command": "set_fan_mode",
  "ts": "2026-01-01T00:00:00Z"
}
```

服务完成后发 result，成功时 status 为 success；失败时为 error，并附 error 字符串。服务错误可能附带 source 调试信息。

```json
{
  "request_id": "client-demo-001",
  "entity_id": "climate.example",
  "status": "error",
  "error": "Command is not allowed: set_fan_mode",
  "ts": "2026-01-01T00:00:01Z"
}
```

先订阅 ack/result 再发命令，因为它们不 retained。验证失败时可能直接返回错误，不发送 ack。非法 JSON 或无有效请求 ID 时，request_id 为 unknown；无法解析设备 Topic 时可能返回到 `gw/home/gateway/command/result`。其他站点命名空间的命令直接忽略。

result 成功只说明服务调用完成。state 独立上报，可能先于 result 到达；未发生变化时可能没有新 state。客户端需按设备 ID 和 request_id 关联回执，并为缺失回执设置超时。

## 投递与在线状态

控制消息必须 retain=false。网关拒绝收到时已标记 retained 的命令，但协议和 Broker 版本可能使实时转发不保留该标记，因此发送方仍必须遵守。request_id 当前仅用于关联，不提供幂等去重；QoS 1 和重试可能导致重复执行，特别注意 toggle、press、场景触发。

设备 availability 当前按最近状态是否 unavailable 映射，不能单独证明连接仍在线；unknown 状态暂仍映射为 online。网关连接状态 Topic 默认是 `gw/home/gateway/availability`，它反映 MQTT 连接，不代表所有设备和上游服务健康，也未承诺 retained。

平台需要结合自身连接、状态时间与现场约定判断数据是否过期。设备移除后旧 retained 消息不会自动清除。
