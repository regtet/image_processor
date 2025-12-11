# 🖼️ 图片批量处理器

自动化批量转换图片为 AVIF 格式并压缩，使用 Playwright 操作 [ImagesTool](https://to.imagestool.com) 在线工具。

## ✨ 功能特点

- 🔄 **批量转换**: 自动将图片转换为 AVIF 格式
- 📦 **自动压缩**: 转换后自动上传到压缩工具进行压缩
- 📁 **多文件夹支持**: 自动处理指定目录下的所有子文件夹
- 🔧 **自定义参数**: 画质 100、压缩强度 1（可在代码中调整）
- 🧹 **自动清理**: 处理完成后自动解压并清理中间文件
- 📂 **嵌套文件夹支持**: 自动检测 2 层嵌套的图片文件夹

## 📋 处理流程

```
原始图片
    ↓
步骤1: 上传到 to.imagestool.com 转换为 AVIF (画质100, 强度1)
    ↓
步骤2: 上传到 tiny.imagestool.com 压缩
    ↓
步骤3: 解压并清理，只保留最终文件
    ↓
处理完成 ✅
```

## 🛠️ 环境要求

- **Node.js** 14.0 或更高版本
- **Windows** 操作系统（使用 PowerShell 解压）

## 🚀 使用方法

### 方法一：双击运行

1. 双击 `run.bat`
2. 按提示选择是否使用默认文件夹（Downloads）
3. 选择是否显示浏览器窗口（建议首次选 Y 观察过程）
4. 按回车开始处理

### 方法二：命令行运行

```bash
# 安装依赖（首次运行）
npm install
npx playwright install chromium

# 运行
node image_processor.js
```

## 📁 目录结构

```
demo/
├── image_processor.js    # 主程序
├── package.json          # 依赖配置
├── run.bat              # Windows 启动脚本
└── README.md            # 项目说明
```

## 📂 输入输出

### 输入目录结构
```
C:\Users\xxx\Downloads\
├── _processed_output/    ← 自动忽略
├── 项目A/
│   ├── 1.png
│   └── 2.png
├── 项目B/
│   └── 活动图/           ← 支持嵌套
│       ├── 1.png
│       └── 2.png
└── 项目C/
    └── images/
        └── logo.png
```

### 输出目录结构
```
C:\Users\xxx\Downloads\_processed_output\
├── 项目A/
│   ├── 1.avif            ← 压缩后的 AVIF
│   └── 2.avif
├── 项目B/
│   ├── 1.avif            ← 扁平化，无嵌套
│   └── 2.avif
└── 项目C/
    └── logo.avif
```

## ⚙️ 配置说明

### 转换参数（在 image_processor.js 中）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 画质 | 100 | 1-100，越高质量越好 |
| 压缩强度 | 1 | 1-8，越低压缩越快 |

### 忽略的文件夹

- `_processed_output` - 输出目录
- `node_modules` - Node.js 依赖
- `.git` - Git 目录

### 支持的图片格式

`.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` `.tiff` `.avif`

## 🔗 使用的在线工具

- **格式转换**: https://to.imagestool.com/zh-CN/image-to-avif
- **图片压缩**: https://tiny.imagestool.com/zh-CN/image-compressor

> 这些工具在浏览器本地运行，图片不会上传到服务器，保护隐私。

## ⚠️ 注意事项

1. **首次运行**需要下载 Chromium 浏览器（约 150MB）
2. **网络要求**：需要稳定的网络连接
3. **处理时间**：取决于图片数量和大小，每张图约需 5-10 秒
4. **网站更新**：如果网站结构变化，可能需要更新选择器

## 🐛 常见问题

### Q: 提示 "未找到下载按钮"
A: 可能是网站还在处理中，脚本会自动等待。如果超时，检查网络连接。

### Q: 只下载了一张图片
A: 单张图片时网站直接下载图片文件而不是 zip，脚本已自动处理。

### Q: 参数没有正确设置
A: 显示浏览器窗口运行，观察滑块是否正确移动。

## 📝 技术栈

- **Playwright** - 浏览器自动化
- **Node.js** - 运行环境
- **PowerShell** - ZIP 解压（Windows）

## 📄 License

MIT License

