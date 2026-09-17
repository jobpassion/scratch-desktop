# ESP32 快捷扩展

“一一编程乐园”支持通过 JSON 快速增加 ESP32 板上编程扩展。新增常见元件时，不需要再修改 JavaScript 代码并重新打包应用。

## 使用方法

1. 打开 Scratch 的“选择一个扩展”页面。
2. 点击右上角“快捷扩展管理”。
3. 可以直接点击“载入多彩 LED 示例”，也可以点击“复制给 AI 的生成规则”。
4. 把规则和元件说明发给 AI，让 AI 只返回 JSON。
5. 把 JSON 粘贴到编辑框，点击“保存并启用”。
6. 扩展会作为独立 Scratch 积木分类加载，并自动进入板上编程模式。

保存后的快捷扩展也会出现在 Scratch 原生扩展选择页中。以后修复 Python 代码或调整积木，再进入“快捷扩展管理”选择对应扩展修改即可。

## JSON 基本结构

```json
{
  "schemaVersion": 1,
  "id": "yyextexample",
  "name": "示例元件",
  "description": "扩展说明",
  "color1": "#0fbd8c",
  "color2": "#0c956f",
  "menus": {},
  "python": {
    "imports": [],
    "helpers": []
  },
  "blocks": [
    {
      "opcode": "doSomething",
      "blockType": "command",
      "text": "示例操作 [VALUE]",
      "arguments": {
        "VALUE": {"type": "number", "defaultValue": 1}
      },
      "python": "some_function({{VALUE}})"
    }
  ]
}
```

## 主要规则

- `schemaVersion` 当前固定为 `1`。
- `id` 必须以 `yyext` 开头，并且只能包含小写字母和数字，例如 `yyextneopixel`。Scratch VM 的扩展 ID 不允许下划线。
- 一个 `id` 对应一个独立 Scratch 积木分类。
- `blockType` 支持 `command`、`reporter`、`boolean`。
- 积木参数在 `text` 中写成 `[PIN]`、`[VALUE]`，并在 `arguments` 中定义同名参数。
- 参数 `type` 支持 `string`、`number`、`boolean`。
- `python` 是 MicroPython 模板，用 `{{参数名}}` 插入参数。
- `command` 可生成多行 Python；`reporter` 和 `boolean` 必须生成单行 Python 表达式。
- `python.imports` 放 MicroPython import；`python.helpers` 放辅助函数和全局缓存。
- 菜单值需要按数字或 Python 常量输出时，可给参数增加 `pythonType`。支持 `auto`、`string`、`number`、`boolean`、`raw`。

示例菜单参数：

```json
{
  "PIN": {
    "type": "string",
    "menu": "pins",
    "defaultValue": "23",
    "pythonType": "number"
  }
}
```

## 多彩 LED 示例

管理页面内置 WS2812 / NeoPixel 示例，包含：设置指定灯珠 RGB、整条灯带填色、全部熄灭，以及 `import neopixel` 和必要的辅助函数。第一次验证快捷扩展能力时可以直接载入这个示例。

## 给 AI 的方式

点击“复制给 AI 的生成规则”会复制完整规则和 NeoPixel 示例。之后只要追加元件需求，例如：

> 给我生成一个用于 ESP32 MicroPython 的超声波传感器扩展。Trig 和 Echo 都能选择 GPIO，提供“读取距离厘米”的记者积木。

让 AI 只返回 JSON，然后粘贴保存即可，不需要再让 AI 修改本仓库代码。

## 修改和兼容

同一个 `id` 再次保存会覆盖原配置。修改 `python`、`imports` 或 `helpers` 后，后续板上发送和仿真代码生成会立即使用新规则。如果修改的是已经加载到当前 Scratch 会话中的积木文字、参数、菜单或积木数量，重启应用后会完整刷新运行时定义。

快捷扩展保存在当前应用的本地存储中，不会自动跟随 `.sb3` 同步到另一台电脑或设备。另一台设备打开使用该快捷扩展的作品前，需要先保存同一个 `id` 的扩展配置。

## 与仿真的关系

这套能力动态解决两层内容：Scratch 积木注册，以及 Scratch 积木到 ESP32 MicroPython 的代码生成。

它不能只靠 JSON 给 Velxio 或其他仿真器增加底层尚不存在的电子元件模型。如果仿真器已经支持对应元件和 MicroPython 模块，例如已经支持 `neopixel`，生成代码即可参与仿真；如果仿真器没有该元件模型，则仍需在仿真器侧增加元件支持。
