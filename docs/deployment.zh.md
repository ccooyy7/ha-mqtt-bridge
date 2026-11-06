# 部署与配置

## 1. 环境准备

需要 Home Assistant、Node-RED、MQTT Broker 和 `node-red-contrib-home-assistant-websocket`。MQTT in/out、Function、Inject 等使用 Node-RED 核心节点。导出模板包含 `server-events` v3 和 `api-call-service` v7 的配置结构；节点包版本需能识别这些结构，尚未给出完整兼容性矩阵。

可以在 HAOS Node-RED Add-on 内部署，也可以在独立 Node-RED 中部署。运行环境必须同时能访问 HA 与 Broker；第三方客户端必须能访问 Broker。

Node.js 20+ 要求针对本仓库构建和测试脚本，不是对所有 HAOS/Node-RED 版本的兼容性承诺。

## 2. 导入流程

1. 已有流程先导出备份，然后导入 `flows/ha-mqtt-bridge.json`。同一命名空间只启用一份网关，避免重复执行命令。
2. 打开 `Home Assistant` 配置节点。Add-on 模式使用所在 HAOS 的连接；独立部署填写自己的地址与长期访问令牌。
3. 确认 HA 状态缓存可用。发现 Function 默认读取 `global.get("homeassistant.homeAssistant.states")`。若读取为空，在 Context Data 中确认缓存路径及服务器配置，再调整此路径。
4. 打开任一 MQTT 节点，编辑 `Local Mosquitto`。默认 `core-mosquitto:1883` 仅适用于能够解析这个主机名的环境；其他环境填写实际 Broker 主机。用户名、密码在凭据区域填写。
5. MQTT Client ID 留空，由客户端生成；如手动填写，每个实例必须唯一。模板使用 MQTT 3.1.1，默认无 TLS，需 TLS 时在 Broker 配置节点中启用。
6. 编辑 `Gateway config` 的暴露范围，见下节。点击部署，等连接就绪，依次点击初始化和发现按钮。

导入后的默认配置是 `manual` + `entity_id`，空实体列表不会暴露设备。初始化前 Function 的默认配置同样不暴露设备。

初始化约在部署后 0.5 秒触发，发现约在 2 秒后触发，并每 10 分钟补发一次。HA 尚未就绪时手动发现即可；定时发现不是实时状态更新的间隔，实时更新由 `state_changed` 事件驱动。

## 3. 手动指定实体

在 `Gateway config` 中修改已有字段，下面是配置片段，不是整个 Function：

```js
exposureMode: "manual",
topicMode: "entity_id",
entities: [
    {
        entity_id: "light.example",
        name: "示例灯",
        writable: true,
        state_fields: ["brightness_pct", "color_temp_kelvin", "friendly_name"],
        commands: ["turn_on", "turn_off"],
        enabled: true
    },
    {
        entity_id: "climate.example",
        name: "示例空调",
        writable: false,
        enabled: true
    }
],
```

- `entity_id`：改为自己的真实实体 ID；示例设备不会自动创建。
- `writable: false`：仍发布状态，但拒绝控制命令。
- `commands`：不填时使用该类型通用命令；空数组拒绝全部命令；填写后只允许列出的且该类型支持的命令。
- `state_fields`：覆盖该实体的业务属性选择。
- `enabled: false`：停止暴露该实体。
- `name`：修改 meta 中的显示名称；state 的 friendly_name 仍来自设备上报。

手动模式的空 `entities` 拒绝全部暴露。手动模式不以 `coreDomains`、`entityAllowlist` 过滤实体，而以实体列表为准；`entityBlocklist` 在两种模式中都优先排除。`writable` 未填写时取 `writableDomains`，实体级值优先。

## 4. 按类型自动暴露

把模式改为 `domains`，保留需要的类型：

```js
exposureMode: "domains",
topicMode: "entity_id",
coreDomains: ["light", "climate", "cover", "sensor"],
writableDomains: ["light", "climate", "cover"],
entities: [],
entityAllowlist: [],
entityBlocklist: [],
```

自动模式下，空 `entityAllowlist` 表示暴露所选类型的所有未排除实体。新增该类型设备后可经发现或状态更新进入网关。若只需要部分设备，填写非空白名单；不要把清空白名单理解成“禁用全部”。禁用全部可回到 `manual` 并设置 `entities: []`。

自动模式中也可以在 `entities` 中为个别实体设置 writable、commands 或字段覆盖；需要排除设备时使用 `entityBlocklist`，不要依靠覆盖项的 `enabled: false` 排除。

要暴露 `input_boolean`，把它加入所需的类型列表。支持范围以映射代码为准，任意增加其他类型名称不会自动获得控制逻辑。

## 5. 字段和 Topic

`stateFields` 选择类型的业务属性，`state_fields` 是实体级覆盖。固定公共字段包括 `entity_id`、`state`、`unit_of_measurement` 和三个时间字段。缺失业务属性为 null。

灯光 `brightness_pct` 由 `Math.round(brightness / 255 * 100)` 得到；空调 `target_temperature` 来自 `temperature`，`hvac_mode` 来自主状态。`units` 仅覆盖单位标签，不进行数值单位转换。

默认 Topic 为 `gw/home/entity/{entity_id}/{endpoint}`。保留了 `topicMode: "domain_object"` 兼容模式，可通过实体 `topic` 或 `aliases` 改变外部 object_id；本项目协议示例统一使用 entity_id 模式。

修改 `site` 或 `topicPrefix` 后，必须同步 MQTT 配置中的 Birth/Close/Will Topic，模板值为 `gw/home/gateway/availability`。订阅方也要同步修改。MQTT in 订阅 `+/+/+/+/set`，命令 Function 会忽略其他 prefix/site 的消息。

重新初始化、执行发现后新配置才进入运行流程；修改本地文件不会自动修改已部署的 Node-RED。

## 6. 测试步骤

使用 MQTT 客户端连接自己的 Broker；也可以运行 [命令脚本](../examples/mosquitto.sh)。脚本中的示例实体需要替换为自己的设备。

```bash
export MQTT_HOST='mqtt.example.invalid'
export MQTT_USER='YOUR_MQTT_USERNAME'
export MQTT_PASSWORD='YOUR_MQTT_PASSWORD'
export MQTT_ENTITY='light.example'
bash examples/mosquitto.sh watch
```

`mqtt.example.invalid` 是故意不可连接的占位域名，不是现成服务器。账号必须先在自己的 Broker 中创建。

一次读取使用 `query`，订阅所有设备状态使用 `all`。`query` 会在收到一条消息后退出，没有 retained 消息时会等待，10 秒后超时。`watch` 持续监听该设备所有 endpoint，Ctrl+C 退出。

在另一个终端设置相同环境变量，再下发命令：

```bash
export MQTT_MESSAGE='{"request_id":"demo-001","command":"turn_on","params":{"brightness_pct":75}}'
bash examples/mosquitto.sh send
```

会实际控制选定设备。先订阅回执再发命令，不要发送 retained 命令。每次使用不同的 request_id；相同 request_id 当前不会被去重。

批量订阅时 `-C 2` 仅表示两条消息，不保证两个设备各一条。平台应按实体 ID 收集结果并设置超时。断线后需恢复连接和订阅，retained 不提供离线期间完整历史。

## 7. 常见问题

| 问题 | 检查项 |
| --- | --- |
| MQTT 已连接，订阅没有消息 | 默认手动列表为空；确认实体配置、初始化、发现、Topic 模式都正确 |
| 发现 0 个实体 | HA 是否已连接、缓存路径是否有数据、实体是否被过滤 |
| state_changed 提示需要实体 | 应使用 `server-events` 事件节点，不是逐实体状态节点 |
| Invalid topic specified | MQTT out 的 Topic 留空，检查上游 msg.topic 非空且不含 +/#，保留 Normalize 节点 |
| 同一条状态重复出现 | 定时发现补发或 QoS 1 重复投递，按设备更新缓存 |
| 删除实体后仍收到状态 | Broker 仍保留旧 retained；只清理确认停用的精确 Topic |
| 服务调用错误 | 检查实体真实能力、服务参数、节点包兼容性和 result.error |
| 客户端命令不存在 | 安装 Mosquitto 客户端并确认 PATH，不需要额外启动一个 Broker |

迁移时导出现场流程并备份凭据恢复方式，记录 HA、Node-RED、节点包和 Broker 版本。普通 flow 导出不等于完整凭据备份。

最后应现场验收状态订阅、属性更新、合法/非法命令，以及分别重启 HA、Node-RED、Broker 后的行为。离线测试不替代这些场景。
